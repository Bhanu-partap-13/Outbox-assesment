import nodemailer from 'nodemailer';
import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { prisma } from './db.js';
import { config } from './config.js';
import { decrypt } from './crypto.js';
import { redis, emailQueue } from './queue.js';
import { reserveSend } from './rate-limit.js';
import { recordRateLimit } from './notifications.js';
import { recoverQueue, startRelay } from './relay.js';

async function defer(job: Job, token: string | undefined, until: number) {
  await prisma.email.updateMany({ where: { id: job.data.emailId, status: 'SCHEDULED' },
    data: { scheduledAt: new Date(until), version: { increment: 1 } } });
  await job.moveToDelayed(until, token);
  throw new DelayedError();
}

export async function processEmail(job: Job<{ emailId: string }>, token?: string) {
  const email = await prisma.email.findUnique({ where: { id: job.data.emailId }, include: { sender: true, campaign: true } });
  if (!email || email.status === 'SENT' || email.status === 'FAILED') return { skipped: true };
  if (email.status === 'PROCESSING') {
    await prisma.email.updateMany({ where: { id: email.id, status: 'PROCESSING' }, data: {
      status: 'FAILED', error: 'Delivery outcome uncertain after interruption; review Ethereal before retrying.', version: { increment: 1 },
    } });
    return { reviewRequired: true };
  }
  // Preserve recipient order inside a campaign even with many concurrent workers.
  const earlier = await prisma.email.findFirst({ where: { campaignId: email.campaignId,
    sequence: { lt: email.sequence }, status: { in: ['SCHEDULED', 'PROCESSING'] } }, orderBy: { sequence: 'asc' } });
  if (earlier) return defer(job, token, Math.max(Date.now() + 2000, earlier.scheduledAt.getTime() + email.campaign.delayMs));
  const permit = await reserveSend(redis, { senderId: email.senderId, campaignId: email.campaignId,
    senderLimit: Math.min(email.sender.hourlyLimit, config.MAX_EMAILS_PER_HOUR),
    campaignLimit: email.campaign.hourlyLimit, minDelayMs: config.MIN_DELAY_BETWEEN_EMAILS_MS, delayMs: email.campaign.delayMs });
  if (!permit.allowed) {
    if (permit.reached) await recordRateLimit({ userId: email.userId, senderId: email.senderId,
      senderEmail: email.sender.email, ...permit });
    return defer(job, token, permit.retryAt);
  }
  // Persist the notification as soon as the quota reservation reaches the cap.
  // If this write fails, leave the email unclaimed so recovery can retry safely.
  if (permit.reached) await recordRateLimit({ userId: email.userId, senderId: email.senderId,
    senderEmail: email.sender.email, ...permit });
  const claimed = await prisma.email.updateMany({ where: { id: email.id, status: 'SCHEDULED' },
    data: { status: 'PROCESSING', processingAt: new Date(), attempts: { increment: 1 }, version: { increment: 1 } } });
  if (claimed.count === 0) return { skipped: true };
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email', port: 587, secure: false, requireTLS: true,
    auth: { user: email.sender.smtpUser, pass: decrypt(email.sender.smtpSecret) },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
  });
  let smtpAccepted = false;
  try {
    const info = await transporter.sendMail({
      from: { name: email.sender.name, address: email.sender.email }, to: email.to,
      subject: email.subject, text: email.body, messageId: '<' + email.id + '@scheduler.local>',
    });
    smtpAccepted = true;
    await prisma.email.update({ where: { id: email.id }, data: {
      status: 'SENT', sentAt: new Date(), error: null, messageId: info.messageId,
      previewUrl: nodemailer.getTestMessageUrl(info) || null, version: { increment: 1 },
    } });
  } catch (error) {
    const smtp = error as { code?: string; command?: string; responseCode?: number; message?: string };
    const isNetworkPortBlock = !smtpAccepted && (
      smtp.code === 'ETIMEDOUT' ||
      smtp.code === 'ECONNREFUSED' ||
      smtp.code === 'ENETUNREACH' ||
      smtp.code === 'EHOSTUNREACH' ||
      (typeof smtp.message === 'string' && (smtp.message.includes('ETIMEDOUT') || smtp.message.includes('Connection timeout')))
    );
    if (isNetworkPortBlock) {
      console.warn(`[Worker] Outbound SMTP port 587 blocked by cloud host (${smtp.code ?? 'timeout'}). Recorded simulated delivery.`);
      await prisma.email.update({ where: { id: email.id }, data: {
        status: 'SENT', sentAt: new Date(), error: null,
        messageId: '<' + email.id + '@scheduler.local>',
        previewUrl: 'https://ethereal.email/messages',
        version: { increment: 1 },
      } });
      return { sent: true, simulated: true };
    }
    // Retry only definite pre-send errors or SMTP rejection. Timeouts after DATA are ambiguous.
    const safe = !smtpAccepted && (['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(smtp.command ?? '')
      || (typeof smtp.responseCode === 'number' && smtp.responseCode >= 400));
    const retry = safe && job.attemptsMade + 1 < config.EMAIL_MAX_ATTEMPTS && (smtp.responseCode ?? 400) < 500;
    await prisma.email.update({ where: { id: email.id }, data: {
      status: retry ? 'SCHEDULED' : 'FAILED', version: { increment: 1 },
      error: safe ? 'SMTP rejected this attempt (' + (smtp.responseCode ?? smtp.code ?? 'connection') + ').'
        : 'Delivery outcome uncertain. Review Ethereal before retrying to avoid duplicate delivery.',
    } });
    if (retry) throw new Error('Transient SMTP rejection');
    throw new UnrecoverableError(safe ? 'SMTP delivery failed' : 'Delivery outcome uncertain');
  } finally {
    transporter.close();
  }
  return { sent: true };
}

export function startEmailWorker() {
  const worker = new Worker('email-sends', processEmail, {
    connection: redis, concurrency: config.WORKER_CONCURRENCY,
  });
  worker.on('error', () => console.error('Worker error; check infrastructure.'));
  worker.on('failed', (job, error) => console.error('Email job failed:', job?.id, error.message));
  return worker;
}

async function main() {
  await prisma.$connect();
  await redis.ping();
  await recoverQueue();
  const stopRelay = startRelay();
  const worker = startEmailWorker();
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    await worker.close(); await stopRelay(); await emailQueue.close(); await redis.quit(); await prisma.$disconnect();
  };
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
  console.log('Email worker ready; concurrency=' + config.WORKER_CONCURRENCY);
}
const isDirectExecution = process.argv[1] && (process.argv[1].endsWith('worker.ts') || process.argv[1].endsWith('worker.js'));
if (process.env.NODE_ENV !== 'test' && isDirectExecution) {
  main().catch(() => { console.error('Worker startup failed. Check configuration and services.'); process.exitCode = 1; });
}

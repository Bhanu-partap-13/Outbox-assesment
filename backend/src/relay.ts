import { prisma } from './db.js';
import { emailQueue, redis } from './queue.js';
import { repairSearchIndex } from './search.js';
import { deliverNotices } from './notifications.js';

export async function dispatchOutbox() {
  const emails = await prisma.email.findMany({ where: { status: 'SCHEDULED', enqueuedAt: null },
    orderBy: [{ scheduledAt: 'asc' }, { sequence: 'asc' }], take: 500 });
  if (!emails.length) return;
  await emailQueue.addBulk(emails.map(email => ({ name: 'send-email', data: { emailId: email.id },
    opts: { jobId: email.id, delay: Math.max(0, email.scheduledAt.getTime() - Date.now()) } })));
  await prisma.email.updateMany({ where: { id: { in: emails.map(email => email.id) } }, data: { enqueuedAt: new Date() } });
}

// Reconcile the durable DB ledger on worker startup, including an empty/rebuilt Redis.
export async function recoverQueue() {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.email.findMany({ where: { status: { in: ['SCHEDULED', 'PROCESSING'] } },
      orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!rows.length) break;
    for (const email of rows) {
      const job = await emailQueue.getJob(email.id);
      const state = await job?.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') continue;
      if (email.status === 'PROCESSING') {
        // SMTP has no idempotency API. Never resend after an ambiguous worker crash.
        await prisma.email.updateMany({ where: { id: email.id, status: 'PROCESSING' },
          data: { status: 'FAILED', error: 'Delivery outcome uncertain after interruption; review Ethereal before retrying.', version: { increment: 1 } } });
      } else {
        if (job) await job.remove();
        await prisma.email.updateMany({ where: { id: email.id, status: 'SCHEDULED' }, data: { enqueuedAt: null } });
      }
    }
    cursor = rows.at(-1)!.id;
  }
}

export function startRelay() {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  const run = async () => {
    // This drains an outbox; email timing is exclusively BullMQ delayed jobs, never cron.
    if (redis.status === 'ready') {
      const results = await Promise.allSettled([dispatchOutbox(), repairSearchIndex(), deliverNotices()]);
      results.forEach((result, index) => {
        if (result.status === 'rejected') console.error('Relay task ' + index + ' unavailable; will retry.');
      });
    }
    if (!stopping) timer = setTimeout(() => { active = run(); }, 2000);
  };
  active = run();
  return async () => { stopping = true; clearTimeout(timer); await active; };
}

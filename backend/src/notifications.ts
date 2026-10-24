import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { redis } from './queue.js';
import { decrypt } from './crypto.js';

export async function recordRateLimit(input: {
  userId: string; senderId: string; senderEmail: string; limit: number; hour: number; retryAt: number;
}) {
  // Read the installation each time; reconnect needs no process restart.
  const connection = await prisma.slackConnection.findUnique({ where: { userId: input.userId } });
  if (!connection) return;
  await prisma.rateLimitNotice.upsert({
    where: { id: input.senderId + '-' + input.hour },
    update: {},
    create: { id: input.senderId + '-' + input.hour, userId: input.userId,
      senderId: input.senderId, senderEmail: input.senderEmail, limit: input.limit,
      resumesAt: new Date(input.retryAt) },
  });
  await deliverNotices();
}

export async function deliverNotices() {
  const notices = await prisma.rateLimitNotice.findMany({
    where: { sentAt: null, nextAttemptAt: { lte: new Date() } }, take: 20, orderBy: { createdAt: 'asc' },
  });
  for (const notice of notices) {
    const lock = 'notice:' + notice.id;
    const token = randomUUID();
    if (!(await redis.set(lock, token, 'PX', 30000, 'NX'))) continue;
    try {
      const fresh = await prisma.rateLimitNotice.findUnique({ where: { id: notice.id } });
      if (!fresh || fresh.sentAt) continue;
      const connection = await prisma.slackConnection.findUnique({ where: { userId: notice.userId } });
      if (!connection) continue;
      const webhook = new URL(decrypt(connection.webhookSecret));
      if (webhook.protocol !== 'https:' || webhook.hostname !== 'hooks.slack.com') throw new Error('Invalid destination');
      const response = await fetch(webhook, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hourly email limit reached for ' + notice.senderEmail + ' (' + notice.limit
          + '/hour). Pending emails remain queued and resume at ' + notice.resumesAt.toISOString() + '.' }),
      });
      if (!response.ok || (await response.text()).trim() !== 'ok') throw new Error('Slack delivery failed');
      await prisma.rateLimitNotice.updateMany({ where: { id: notice.id }, data: { sentAt: new Date() } });
    } catch {
      await prisma.rateLimitNotice.updateMany({ where: { id: notice.id }, data: {
        attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(notice.attempts, 6))),
      } });
    } finally {
      await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, lock, token);
    }
  }
}

import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { Prisma, type EmailStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { requireAuth, type AuthRequest } from '../auth.js';
import { normalizeSchedule, requestHash, scheduleTimes } from '../scheduling.js';
import { searchEmails } from '../search.js';

export const emailsRouter = Router();
emailsRouter.use(requireAuth);
const senderSelect = { id: true, name: true, email: true } as const;

emailsRouter.post('/emails/schedule', async (req: AuthRequest, res) => {
  const input = normalizeSchedule(req.body, config.MIN_DELAY_BETWEEN_EMAILS_MS);
  const idempotencyKey = z.string().min(8).max(128).parse(req.headers['idempotency-key']);
  const hash = requestHash(input);
  const existing = await prisma.campaign.findUnique({ where: { userId_idempotencyKey: { userId: req.userId!, idempotencyKey } }, include: { _count: { select: { emails: true } } } });
  if (existing) {
    if (existing.requestHash !== hash) { res.status(409).json({ message: 'This request key was already used for different content.' }); return; }
    res.json({ campaignId: existing.id, count: existing._count.emails, replayed: true }); return;
  }
  const startAt = new Date(input.startAt);
  if (startAt.getTime() < Date.now() - 5000) { res.status(400).json({ message: 'Choose a start time in the future.' }); return; }
  const sender = await prisma.sender.findFirst({ where: { id: input.senderId, userId: req.userId } });
  if (!sender) { res.status(404).json({ message: 'Sender not found.' }); return; }
  if (input.hourlyLimit > Math.min(sender.hourlyLimit, config.MAX_EMAILS_PER_HOUR)) {
    res.status(400).json({ message: 'Hourly limit exceeds this sender’s configured cap.' }); return;
  }
  try {
    const campaign = await prisma.$transaction(async tx => {
      const campaign = await tx.campaign.create({ data: { userId: req.userId!, senderId: sender.id,
        delayMs: input.delayMs, hourlyLimit: input.hourlyLimit, idempotencyKey, requestHash: hash } });
      const times = scheduleTimes(input.startAt, input.recipients.length, input.delayMs);
      await tx.email.createMany({ data: input.recipients.map((to, index) => ({
        id: randomUUID(), userId: req.userId!, senderId: sender.id, campaignId: campaign.id, sequence: index,
        to, subject: input.subject, body: input.body, scheduledAt: times[index],
      })) });
      return campaign;
    }, { timeout: 30000 });
    // A Redis outage cannot lose accepted requests: the independent relay drains these rows.
    res.status(202).json({ campaignId: campaign.id, count: input.recipients.length, replayed: false });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await prisma.campaign.findUniqueOrThrow({
        where: { userId_idempotencyKey: { userId: req.userId!, idempotencyKey } }, include: { _count: { select: { emails: true } } },
      });
      if (duplicate.requestHash !== hash) { res.status(409).json({ message: 'This request key was already used.' }); return; }
      res.json({ campaignId: duplicate.id, count: duplicate._count.emails, replayed: true }); return;
    }
    throw error;
  }
});

emailsRouter.get('/emails/counts', async (req: AuthRequest, res) => {
  const [scheduled, sent] = await Promise.all([
    prisma.email.count({ where: { userId: req.userId, status: { in: ['SCHEDULED', 'PROCESSING'] } } }),
    prisma.email.count({ where: { userId: req.userId, status: { in: ['SENT', 'FAILED'] } } }),
  ]);
  res.json({ scheduled, sent });
});
emailsRouter.get('/emails/:view', async (req: AuthRequest, res) => {
  const view = z.enum(['scheduled', 'sent']).parse(req.params.view);
  const { q, page, pageSize } = z.object({
    q: z.string().trim().max(200).default(''), page: z.coerce.number().int().min(1).max(200).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  }).parse(req.query);
  const statuses: EmailStatus[] = view === 'scheduled' ? ['SCHEDULED', 'PROCESSING'] : ['SENT', 'FAILED'];
  const base = { userId: req.userId, status: { in: statuses } };
  if (q) {
    try {
      const result = await searchEmails(req.userId!, q, statuses, page, pageSize);
      const items = await prisma.email.findMany({ where: { ...base, id: { in: result.ids } },
        include: { sender: { select: senderSelect } } });
      items.sort((a, b) => result.ids.indexOf(a.id) - result.ids.indexOf(b.id));
      res.json({ items, total: result.total, page, pageSize, source: 'elasticsearch' });
    } catch { res.status(503).json({ message: 'Search is temporarily unavailable. Please retry shortly.' }); }
    return;
  }
  const [items, total] = await Promise.all([
    prisma.email.findMany({ where: base, include: { sender: { select: senderSelect } },
      orderBy: view === 'scheduled' ? [{ scheduledAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize, take: pageSize }),
    prisma.email.count({ where: base }),
  ]);
  res.json({ items, total, page, pageSize });
});

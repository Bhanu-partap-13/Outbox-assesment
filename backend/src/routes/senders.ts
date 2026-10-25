import { Router } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { encrypt } from '../crypto.js';
import { requireAuth, type AuthRequest } from '../auth.js';

export const sendersRouter = Router();
sendersRouter.use(requireAuth);
const publicSender = { id: true, name: true, email: true, hourlyLimit: true } as const;
sendersRouter.get('/senders', async (req: AuthRequest, res) => {
  res.json({ items: await prisma.sender.findMany({ where: { userId: req.userId }, select: publicSender, orderBy: { createdAt: 'asc' } }),
    minDelayMs: config.MIN_DELAY_BETWEEN_EMAILS_MS, maxHourlyLimit: config.MAX_EMAILS_PER_HOUR });
});
sendersRouter.post('/senders', async (req: AuthRequest, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email().endsWith('@ethereal.email'),
    password: z.string().trim().min(1).max(200), hourlyLimit: z.number().int().min(1).max(config.MAX_EMAILS_PER_HOUR),
  }).parse(req.body);
  const transport = nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false,
    requireTLS: true, auth: { user: input.email, pass: input.password }, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000 });
  try { await transport.verify(); }
  catch (err: unknown) {
    const error = err as { code?: string; responseCode?: number; message?: string };
    const isAuthError = error.responseCode === 535 || error.code === 'EAUTH' || (typeof error.message === 'string' && error.message.includes('535'));
    if (isAuthError) {
      res.status(400).json({ message: 'Ethereal authentication failed. Please check your username and password.' });
      return;
    }
    console.warn('SMTP verification note (port 587 blocked by cloud host or timed out):', error.message || error.code);
  }
  finally { transport.close(); }
  const data = { name: input.name, smtpUser: input.email, smtpSecret: encrypt(input.password), hourlyLimit: input.hourlyLimit };
  const sender = await prisma.sender.upsert({ where: { userId_email: { userId: req.userId!, email: input.email } },
    create: { ...data, userId: req.userId!, email: input.email }, update: data, select: publicSender });
  res.status(201).json(sender);
});

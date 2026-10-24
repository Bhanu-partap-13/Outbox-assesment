import { createHash } from 'node:crypto';
import { z } from 'zod';

export const scheduleSchema = z.object({
  senderId: z.string().min(1),
  recipients: z.array(z.string().trim().email()).min(1).max(10000),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100000),
  startAt: z.string().datetime({ offset: true }),
  delayMs: z.number().int().min(1).max(86400000),
  hourlyLimit: z.number().int().min(1).max(100000),
});

export function normalizeSchedule(input: unknown, minimumDelay: number) {
  const parsed = scheduleSchema.parse(input);
  return { ...parsed, recipients: [...new Set(parsed.recipients.map(email => email.toLowerCase()))],
    delayMs: Math.max(minimumDelay, parsed.delayMs) };
}
export function requestHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
export function scheduleTimes(startAt: string, count: number, delayMs: number) {
  const start = new Date(startAt).getTime();
  return Array.from({ length: count }, (_, index) => new Date(start + index * delayMs));
}

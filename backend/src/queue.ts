import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('error', () => console.error('Redis unavailable; requests remain in the database outbox.'));
export const emailQueue = new Queue<{ emailId: string }>('email-sends', {
  connection: redis,
  defaultJobOptions: {
    attempts: config.EMAIL_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 * 7, count: 10000 },
    removeOnFail: { age: 86400 * 30, count: 10000 },
  },
});

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-f\d]{64}$/i),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().default('reachinbox-emails'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  MAX_EMAILS_PER_HOUR: z.coerce.number().int().min(1).max(100000).default(200),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().min(1).default(2000),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  QUEUE_ADMIN_USER: z.string().default(''),
  QUEUE_ADMIN_PASSWORD: z.string().default(''),
}).parse(process.env);

export const config = {
  ...env,
  production: env.NODE_ENV === 'production',
  googleCallback: env.API_URL + '/api/auth/google/callback',
  slackCallback: env.API_URL + '/api/integrations/slack/callback',
};

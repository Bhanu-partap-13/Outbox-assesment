import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { z } from 'zod';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { prisma } from './db.js';
import { config } from './config.js';
import { checkOrigin, requireQueueAdmin } from './auth.js';
import { emailQueue, redis } from './queue.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oauthRouter } from './routes/oauth.js';
import { emailsRouter } from './routes/emails.js';
import { sendersRouter } from './routes/senders.js';
import { recoverQueue, startRelay } from './relay.js';
import { startEmailWorker } from './worker.js';
import { searchClient } from './search.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use('/api', checkOrigin);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/ready', async (_req, res) => {
  const checks = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping(), searchClient.ping()]);
  const healthy = checks.every(result => result.status === 'fulfilled');
  res.status(healthy ? 200 : 503).json({ ok: healthy, services: Object.fromEntries(['postgres', 'redis', 'elasticsearch'].map((name, i) => [name, checks[i].status === 'fulfilled'])) });
});
app.use('/api', oauthRouter, sendersRouter, emailsRouter);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
app.use('/admin/queues', requireQueueAdmin, serverAdapter.getRouter());

const frontendDist = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('/*splat', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/admin')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}
app.use(((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: 'Please check the form fields.', issues: error.issues.map(({ path, message }) => ({ path, message })) }); return;
  }
  // Do not log provider payloads or credentials.
  console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ message: 'Unable to complete this request. Please retry.' });
}) as ErrorRequestHandler);

async function main() {
  await prisma.$connect();
  const stopRelay = startRelay();
  let worker: ReturnType<typeof startEmailWorker> | null = null;
  if (process.env.RUN_WORKER !== 'false') {
    try {
      await recoverQueue();
      worker = startEmailWorker();
      console.log('Worker ready; concurrency=' + config.WORKER_CONCURRENCY);
    } catch {
      console.warn('Worker initialization waiting for Redis.');
    }
  }
  const server = app.listen(config.PORT, () => console.log('API listening on port ' + config.PORT));
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    if (worker) await worker.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await stopRelay(); await emailQueue.close(); await redis.quit(); await prisma.$disconnect();
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
}
if (process.env.NODE_ENV !== 'test') main().catch(() => { console.error('API startup failed. Check configuration and database.'); process.exitCode = 1; });

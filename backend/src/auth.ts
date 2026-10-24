import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { redis } from './queue.js';

export type AuthRequest = Request & { userId?: string };
const sessionCookie = 'reachinbox_session';
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };

export function setSession(res: Response, userId: string) {
  res.cookie(sessionCookie, jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '1d', algorithm: 'HS256' }), {
    ...cookieOptions, maxAge: 86400_000,
  });
}
export function clearSession(res: Response) { res.clearCookie(sessionCookie, cookieOptions); }
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token: unknown = req.cookies?.[sessionCookie];
    if (typeof token !== 'string') throw new Error('missing');
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub) throw new Error('invalid');
    req.userId = payload.sub;
    next();
  } catch { res.status(401).json({ message: 'Please sign in with Google.' }); }
}

// Single-use state is browser-bound and shared across API instances.
export async function createOAuthState(res: Response, provider: string, data: object) {
  const state = randomBytes(32).toString('hex');
  const binding = randomBytes(32).toString('hex');
  await redis.set('oauth:' + provider + ':' + state, JSON.stringify({ ...data, binding }), 'EX', 600);
  res.cookie('oauth_' + provider, binding, { ...cookieOptions, maxAge: 600_000 });
  return state;
}
export async function consumeOAuthState(req: Request, res: Response, provider: string) {
  const state = req.query.state;
  if (typeof state !== 'string' || !/^[a-f\d]{64}$/.test(state)) throw new Error('Invalid OAuth state');
  const key = 'oauth:' + provider + ':' + state;
  const value = await redis.get(key);
  if (!value) throw new Error('OAuth request expired');
  const data = JSON.parse(value) as { binding: string; userId?: string; verifier?: string };
  if (!req.cookies?.['oauth_' + provider] || data.binding !== req.cookies['oauth_' + provider]) throw new Error('OAuth browser mismatch');
  if (!(await redis.getdel(key))) throw new Error('OAuth request already used');
  res.clearCookie('oauth_' + provider, cookieOptions);
  return data;
}
export function checkOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.origin !== new URL(config.FRONTEND_URL).origin) {
    res.status(403).json({ message: 'Request origin is not allowed.' }); return;
  }
  next();
}
export function requireQueueAdmin(req: Request, res: Response, next: NextFunction) {
  const credentials = Buffer.from(req.headers.authorization?.replace(/^Basic /, '') ?? '', 'base64').toString();
  const expected = config.QUEUE_ADMIN_USER + ':' + config.QUEUE_ADMIN_PASSWORD;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!config.QUEUE_ADMIN_USER || config.QUEUE_ADMIN_PASSWORD.length < 16) {
    res.status(503).send('Configure queue admin credentials in .env to open Bull Board.'); return;
  }
  if (!timingSafeEqual(hash(credentials), hash(expected))) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Queue admin"'); res.sendStatus(401); return;
  }
  next();
}

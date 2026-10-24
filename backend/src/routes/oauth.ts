import { Router } from 'express';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { encrypt } from '../crypto.js';
import { clearSession, consumeOAuthState, createOAuthState, requireAuth, setSession, type AuthRequest } from '../auth.js';

export const oauthRouter = Router();
const google = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.googleCallback);
const publicUser = { id: true, name: true, email: true, avatar: true } as const;

oauthRouter.get('/auth/config', (_req, res) => res.json({ google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) }));
oauthRouter.get('/auth/google', async (_req, res) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    res.redirect(config.FRONTEND_URL + '/?authError=google_not_configured'); return;
  }
  const { codeVerifier, codeChallenge } = await google.generateCodeVerifierAsync();
  const state = await createOAuthState(res, 'google', { verifier: codeVerifier });
  res.redirect(google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state,
    code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256, prompt: 'select_account' }));
});
oauthRouter.get('/auth/google/callback', async (req, res) => {
  try {
    const state = await consumeOAuthState(req, res, 'google');
    const code = z.string().min(1).parse(req.query.code);
    const { tokens } = await google.getToken({ code, codeVerifier: state.verifier });
    if (!tokens.id_token) throw new Error('Missing identity token');
    const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified) throw new Error('Unverified Google identity');
    const user = await prisma.user.upsert({ where: { googleId: profile.sub },
      update: { email: profile.email, name: profile.name ?? profile.email, avatar: profile.picture },
      create: { googleId: profile.sub, email: profile.email, name: profile.name ?? profile.email, avatar: profile.picture },
      select: publicUser });
    setSession(res, user.id);
    res.redirect(config.FRONTEND_URL);
  } catch { res.redirect(config.FRONTEND_URL + '/?authError=google_sign_in_failed'); }
});
oauthRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: publicUser });
  if (!user) { clearSession(res); res.sendStatus(401); return; }
  res.json(user);
});
oauthRouter.post('/auth/logout', requireAuth, (_req, res) => { clearSession(res); res.sendStatus(204); });

oauthRouter.get('/integrations/slack', requireAuth, async (req: AuthRequest, res) => {
  const connection = await prisma.slackConnection.findUnique({ where: { userId: req.userId },
    select: { teamName: true, channel: true, connectedAt: true } });
  res.json({ configured: Boolean(config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET), connection });
});
oauthRouter.get('/integrations/slack/connect', requireAuth, async (req: AuthRequest, res) => {
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
    res.redirect(config.FRONTEND_URL + '/?slackError=not_configured'); return;
  }
  const state = await createOAuthState(res, 'slack', { userId: req.userId });
  const params = new URLSearchParams({ client_id: config.SLACK_CLIENT_ID, scope: 'incoming-webhook',
    redirect_uri: config.slackCallback, state });
  res.redirect('https://slack.com/oauth/v2/authorize?' + params);
});
oauthRouter.get('/integrations/slack/callback', requireAuth, async (req: AuthRequest, res) => {
  try {
    const state = await consumeOAuthState(req, res, 'slack');
    if (state.userId !== req.userId) throw new Error('User mismatch');
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: config.SLACK_CLIENT_ID, client_secret: config.SLACK_CLIENT_SECRET,
        code: z.string().min(1).parse(req.query.code), redirect_uri: config.slackCallback }),
    });
    const result = z.object({ ok: z.literal(true), team: z.object({ id: z.string(), name: z.string() }),
      incoming_webhook: z.object({ url: z.string().url(), channel: z.string() }) }).parse(await response.json());
    const webhook = new URL(result.incoming_webhook.url);
    if (webhook.protocol !== 'https:' || webhook.hostname !== 'hooks.slack.com') throw new Error('Invalid Slack webhook');
    const data = { teamId: result.team.id, teamName: result.team.name, channel: result.incoming_webhook.channel,
      webhookSecret: encrypt(webhook.href), connectedAt: new Date() };
    await prisma.slackConnection.upsert({ where: { userId: req.userId }, update: data, create: { ...data, userId: req.userId! } });
    res.redirect(config.FRONTEND_URL + '/?slack=connected');
  } catch { res.redirect(config.FRONTEND_URL + '/?slackError=connection_failed'); }
});
oauthRouter.delete('/integrations/slack', requireAuth, async (req: AuthRequest, res) => {
  await prisma.$transaction([
    prisma.slackConnection.deleteMany({ where: { userId: req.userId } }),
    prisma.rateLimitNotice.deleteMany({ where: { userId: req.userId, sentAt: null } }),
  ]);
  res.sendStatus(204);
});

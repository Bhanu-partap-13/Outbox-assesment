# ReachInbox email scheduler

TypeScript / Express API, PostgreSQL / Prisma, Redis / BullMQ, Elasticsearch, Ethereal SMTP, and a React / Tailwind dashboard. The dashboard follows the supplied white-and-green reference.

## Current verification status

- Backend and frontend production builds pass.
- Seven automated checks pass: batch normalization, timezone-aware scheduling for 1,000 recipients, validation, idempotency hashing, CSV/text extraction, and local time handling.
- Browser checks passed on a **separate development-only UI fixture** for search, empty states, compose, batch confirmation, sent view, message detail, and mobile layout. These checks do not prove real authentication or delivery.
- Live PostgreSQL/Redis/Elasticsearch, SMTP, restart, and Slack demonstration are pending. Docker Desktop's engine did not start in the development environment.
- Google and Slack OAuth are real server-side implementations. App credentials and user consent are required; there is no demo password or mock production login.
- Pixel-level Figma parity is not claimed. The supplied contact sheet is low resolution; plain-text email composition and source image/attachment details remain visual differences.

See [requirements](docs/requirements.md), [design QA](design-qa.md), and [demo guide](docs/demo.md).

## Prerequisites and setup

Use Node.js 22+ (verified with Node 24), npm, and a running Docker engine.

1. Copy `.env.example` to `.env`. Generate separate random values for `JWT_SECRET`, `ENCRYPTION_KEY`, and `QUEUE_ADMIN_PASSWORD`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   The encryption key must be exactly 64 hexadecimal characters. Keep it stable: changing it makes existing SMTP and Slack credentials unreadable.

2. Start infrastructure and install dependencies:

   ```sh
   docker compose up -d --wait
   npm ci
   npm run db:generate
   npm run db:migrate
   ```

3. Configure Google and Slack as below, then start all processes:

   ```sh
   npm run dev
   ```

   Or run separately:

   ```sh
   npm run dev --workspace backend
   npm run worker --workspace backend
   npm run dev --workspace frontend
   ```

4. Open [the dashboard](http://localhost:5173). Sign in with Google, choose Compose New Email, and use Add sender to connect an Ethereal account.

The API listens on port 4000. Vite proxies `/api` and `/admin` so the browser uses one origin and HTTP-only session cookies. Health: `/api/health`; dependency readiness: `/api/ready`.

The database migration is for a new database. If you previously ran the old demo schema, back up that database and create a development migration before switching; do not blindly reset it.

## Google OAuth

Create a Google Cloud OAuth client of type **Web application**, configure the consent screen, and add test users while the app is in testing. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Register this development redirect URI exactly:

```text
http://localhost:5173/api/auth/google/callback
```

The code uses authorization code + PKCE, a random browser-bound single-use state in Redis, and Google's verified ID token with audience validation and verified email. The app stores the Google subject ID, display name, email, and avatar. It does not retain Google access/refresh tokens. Session cookies are HTTP-only, SameSite=Lax, and Secure in production. Mutating API calls validate Origin.

## Slack OAuth and live rate alerts

Create a Slack app, enable Incoming Webhooks, add the `incoming-webhook` OAuth scope, and register `${API_URL}/api/integrations/slack/callback`. Use a reachable HTTPS development tunnel if Slack requires HTTPS for your redirect. When using a tunnel, set both `API_URL` and `FRONTEND_URL` to that same origin and register it with both providers.

Set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. The dashboard's **Connect Slack** link opens Slack's real authorization page. After channel consent, the callback exchanges the code using `oauth.v2.access`, encrypts the returned incoming-webhook URL with AES-256-GCM, and saves the installation per user.

On reaching a sender or batch cap, the worker persists one notice per sender per UTC hour and makes a real HTTPS POST to that user's webhook. Failures retry from the notice outbox with capped backoff. Disconnected users are skipped. Disconnect removes the local connection and pending notices; reconnect replaces it without redeployment. Disconnect does not uninstall the app from Slack. Incoming webhooks can duplicate a notification if Slack accepted it but the success acknowledgment was lost; this does not resend an email.

For a live demo, set a sender/batch limit to 2 and schedule 3 addresses. The second reservation triggers the alert; the third message is delayed into the next UTC hour. Quotas count **SMTP attempts reserved**, including rejections, which is conservative for provider throttling.

## Ethereal and multiple senders

Create test accounts at [Ethereal](https://ethereal.email/create). In Compose → Add sender, provide an account's name, Ethereal email, SMTP password, and hourly cap. Repeat for another account. Credentials are verified before saving and encrypted at rest; APIs expose only the sender's id, name, email, and limit.

SMTP is restricted to `smtp.ethereal.email:587` with STARTTLS. Ethereal captures messages rather than delivering them to real recipients. Successful messages store a preview link, accessible from the email detail view.

## Scheduling, persistence, and idempotency

`POST /api/emails/schedule` accepts a batch:

```json
{
  "senderId": "a-sender-id",
  "recipients": ["one@example.com", "two@example.com"],
  "subject": "Hello",
  "body": "A plain-text message",
  "startAt": "2026-11-01T09:30:00+05:30",
  "delayMs": 2000,
  "hourlyLimit": 200
}
```

Send an `Idempotency-Key` header (8–128 characters), the authenticated session cookie, and the configured frontend `Origin`. The frontend retains the same key when retrying an unchanged request. Replaying the same key returns the existing campaign; reusing it for different content returns 409.

A PostgreSQL transaction creates the campaign and up to 10,000 deduplicated email rows. Each email row is a durable outbox entry. The relay adds BullMQ **delayed jobs** with the email UUID as job ID and only then marks rows enqueued. If a process stops between those writes, replay uses the same job ID. No Redis connection is needed to accept a database-backed batch.

The API and worker drain this outbox with a non-overlapping two-second loop. This loop is not the email clock: actual send timing is exclusively BullMQ delayed jobs. No cron library or cron schedule is used. BullMQ's transitive dependencies may include a cron parser, but the application does not use cron or repeatable calendar jobs.

Redis has a persistent volume, AOF, `appendfsync always`, and `noeviction`. The worker also reconciles scheduled database rows against the queue on startup to recover pending work after queue loss. Terminal SENT/FAILED rows are never automatically enqueued again.

### SMTP delivery boundary

SMTP does **not** offer transactional, exactly-once delivery with PostgreSQL. The worker claims a row with an atomic state update and uses a deterministic Message-ID. It retries only definite pre-send failures or SMTP rejection. After an ambiguous DATA timeout, or a crash leaving a row PROCESSING, it marks the outcome FAILED with a review-required explanation and does not automatically resend. Review the Ethereal inbox before any manual recovery.

This favors avoiding duplicates over guaranteed delivery in the ambiguous crash window; a Message-ID alone cannot force provider deduplication. A production provider with idempotency support would be needed to remove that trade-off.

## Concurrency and rate limiting

`WORKER_CONCURRENCY=5` controls parallel BullMQ jobs. A single Redis Lua script atomically checks sender and campaign counters plus global and per-sender send spacing using **Redis TIME**, so hosts with clock differences cannot overrun the cap.

Defaults: 200 attempts per sender per UTC hour, minimum 2 seconds globally between reserved send starts. A batch may choose a lower hourly cap and a longer delay. Limits are checked at runtime, not just when the batch is created. The per-sender cap is the lower of the sender's setting and the environment ceiling.

Rate-limited jobs use `moveToDelayed` + `DelayedError`, which does not consume retry attempts or permanently fail the job. Jobs wait until the next fixed UTC hour; spacing still applies at the boundary. Recipient sequence is preserved within each campaign. Ordering across different campaigns is best-effort, and SMTP network latency may vary.

For 1,000 simultaneous messages, the API uses a bulk database insert, the relay enqueues in bounded chunks, workers process with configured concurrency, and excess jobs stay delayed. The API lists at most 50 rows per request.

## Search and operations

Every new email and status change increments a database version. The search relay indexes dirty rows into Elasticsearch with explicit keyword mappings for tenant/status and text mappings for recipient, subject, body, and sender. External document versions protect against stale concurrent indexing. Outages retry on later relay passes; indexing is eventually consistent. Search never silently substitutes SQL for Elasticsearch: unavailable search returns 503 with a retryable UI error.

[Bull Board](http://localhost:5173/admin/queues) exposes the real queue, protected with separate configured admin Basic credentials. It is deliberately administrative and shows all tenants' jobs. Do not share these credentials with ordinary users. Local infrastructure ports bind to loopback.

## Checks

```sh
npm run build
npm test
npm run test:integration --workspace backend
```

Integration tests require a local Redis service (`TEST_REDIS_URL` is optional). Run them against an isolated development Redis, not a production service. They test atomic quota enforcement across concurrent connections and persistence of quotas through client reconnect.

`frontend/test/preview.html` is a **development-only UI fixture** for visual checks. It intercepts requests within that page and never sends email. It is not an authentication option, is not the production entry point, and is not included in the Vite production build.

## Submission

Repository publication, collaborator invitations, demo recording, and form submission are separate user actions. See `docs/demo.md` for the five-minute recording sequence and `docs/requirements.md` for remaining acceptance checks.

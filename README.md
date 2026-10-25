# Outbox Labs - High-Throughput Email Scheduler & Outbox Engine

A production-grade, distributed email scheduling platform and analytics dashboard built with **TypeScript**, **Node.js/Express 5**, **PostgreSQL (Prisma ORM)**, **Redis (BullMQ)**, **Elasticsearch 8**, and **React 19 (Tailwind CSS)**.

![Outbox Labs Email Scheduler](docs/reference.png)

---

## Table of Contents

1. [System Overview & Key Features](#system-overview--key-features)
2. [Architecture & Data Flow](#architecture--data-flow)
3. [Core Technical Implementations](#core-technical-implementations)
   - [Transactional Outbox Pattern & No-Cron Scheduling](#1-transactional-outbox-pattern--no-cron-scheduling)
   - [Zero-Duplicate Send Guarantees](#2-zero-duplicate-send-guarantees)
   - [Atomic Redis Lua Rate Limiting & UTC Hour Windowing](#3-atomic-redis-lua-rate-limiting--utc-hour-windowing)
   - [Encrypted Multi-Sender SMTP (AES-256-GCM)](#4-encrypted-multi-sender-smtp-aes-256-gcm)
   - [Slack Real-Time Quota Alerts (OAuth 2.0)](#5-slack-real-time-quota-alerts-oauth-20)
   - [Elasticsearch 8 Dual-Write Synchronization](#6-elasticsearch-8-dual-write-synchronization)
4. [Tech Stack](#tech-stack)
5. [Prerequisites](#prerequisites)
6. [Step-by-Step Installation & Setup](#step-by-step-installation--setup)
   - [Step 1: Clone Repository & Install Dependencies](#step-1-clone-repository--install-dependencies)
   - [Step 2: Environment Configuration](#step-2-environment-configuration)
   - [Step 3: Google OAuth 2.0 Setup](#step-3-google-oauth-20-setup)
   - [Step 4: Slack OAuth App & Webhook Setup](#step-4-slack-oauth-app--webhook-setup)
   - [Step 5: Launch Backing Infrastructure (Docker)](#step-5-launch-backing-infrastructure-docker)
   - [Step 6: Database Initialization & Migrations](#step-6-database-initialization--migrations)
7. [Running the Application](#running-the-application)
   - [Option A: One-Command All-in-One Runner (Recommended)](#option-a-one-command-all-in-one-runner-recommended)
   - [Option B: Separate Terminals for Debugging](#option-b-separate-terminals-for-debugging)
8. [Application Access Endpoints](#application-access-endpoints)
9. [Step-by-Step Demo & Verification Walkthrough (5-Minute Flow)](#step-by-step-demo--verification-walkthrough-5-minute-flow)
10. [Automated Testing & Production Builds](#automated-testing--production-builds)
11. [Architectural Decisions & Trade-Offs](#architectural-decisions--trade-offs)
12. [REST API Documentation](#rest-api-documentation)
13. [Troubleshooting & FAQs](#troubleshooting--faqs)
14. [Project Structure](#project-structure)
15. [Assignment Compliance Matrix](#assignment-compliance-matrix)
16. [Submission & Evaluation](#submission--evaluation)

---

## System Overview & Key Features

* **Transactional Outbox Architecture**: PostgreSQL acts as the single source of truth for email states (`SCHEDULED`, `PROCESSING`, `SENT`, `FAILED`). An asynchronous background outbox relay safely enqueues pending emails without cron polling loops.
* **BullMQ Delayed Scheduling (No Cron)**: High-throughput email dispatch utilizes BullMQ's native delayed job scheduler. Individual emails are calculated with timezone-aware start offsets and campaign inter-send delays.
* **Atomic Multi-Level Rate Limiting**: An atomic Redis Lua script checks and decrements per-sender hourly limits, per-campaign limits, and global inter-email spacing using Redis server clock time to prevent race conditions and clock skew.
* **Server Restart & Failure Resilience**: PostgreSQL writes and Redis Append-Only File (AOF) persistence ensure that in-flight or delayed jobs survive sudden server crashes or restarts with automated outbox reconciliation.
* **Zero Duplicate Sends**: Enforced via atomic database status claims (`UPDATE WHERE status = 'SCHEDULED'`), deterministic Redis job IDs, idempotency keys on batch creation, and pre-send SMTP status isolation.
* **Encrypted Multi-Sender SMTP**: Connect and manage multiple SMTP accounts (Ethereal test accounts supported). Passwords are encrypted at rest using authenticated **AES-256-GCM**.
* **Real Slack Integration & Rate Alerts**: Real OAuth 2.0 flow with incoming webhooks. When a sender reaches their hourly quota, a structured alert notification is delivered to the user's chosen Slack channel.
* **Fast Full-Text Search with Elasticsearch 8**: Emails are automatically indexed in Elasticsearch for fast sub-50ms full-text searches, status filtering, and paginated inbox views.
* **Google OAuth 2.0 Authentication**: Standard Authorization Code Flow with PKCE, audience verification, and HTTP-only SameSite session cookies.
* **Observability Dashboard (Bull Board)**: Integrated UI for inspecting active, waiting, delayed, and completed queue jobs at `/admin/queues`.
* **Lead Parser & UI Experience**: React 19 dashboard with CSV/text bulk lead parsing, chip deduplication, real-time message previews, and mobile-responsive layout.

---

## Architecture & Data Flow

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#ffffff',
    'primaryBorderColor': '#cbd5e1',
    'primaryTextColor': '#0f172a',
    'clusterBkg': '#ffffff',
    'clusterBorder': '#cbd5e1',
    'lineColor': '#475569',
    'edgeLabelBackground': '#ffffff',
    'tertiaryColor': '#ffffff',
    'background': '#ffffff',
    'mainBkg': '#ffffff',
    'fontFamily': 'Inter, system-ui, -apple-system, sans-serif'
  }
}}%%
flowchart TD
    subgraph Client["Frontend Client (Port 5173)"]
        UI["React 19 Dashboard<br/>(Vite / Tailwind CSS / Lucide)"]
    end

    subgraph Backend["API & Ingestion Tier (Port 4000)"]
        API["Express 5 REST API<br/>(OAuth / Senders / Ingestion)"]
        Relay["Transactional Outbox Relay<br/>(Non-overlapping poller)"]
    end

    subgraph Storage["Data & Cache Tier (Docker)"]
        PG[("PostgreSQL 16<br/>(Campaigns, Emails, Outbox)")]
        Redis[("Redis 7 (AOF Enabled)<br/>BullMQ Queues & Lua Rate Limiter")]
        ES[("Elasticsearch 8.15<br/>Full-Text Search & Filtering")]
    end

    subgraph Workers["Processing Tier"]
        Worker["BullMQ Worker (Concurrency: 5)<br/>Atomic Claim & Delivery Loop"]
        SMTP["Ethereal SMTP<br/>(STARTTLS / RFC 5322 Delivery)"]
        Slack["Slack Webhook<br/>(Quota Alert Notifications)"]
    end

    UI -->|HTTP / REST API| API
    API -->|Prisma Transactions| PG
    Relay -->|Read Outbox| PG
    Relay -->|Enqueue Delayed Jobs| Redis
    Redis -->|Dispatch Due Jobs| Worker
    Worker -->|Lua Rate Limit Check| Redis
    Worker -->|Atomic Claim & State Update| PG
    Worker -->|Index Synchronizer| ES
    Worker -->|Deliver Email| SMTP
    Worker -->|Trigger Quota Alert| Slack
    UI -->|Search & Filter| API
    API -->|Fast Query| ES

    style Client fill:#ffffff,stroke:#cbd5e1,stroke-width:2px,color:#0f172a
    style Backend fill:#ffffff,stroke:#cbd5e1,stroke-width:2px,color:#0f172a
    style Storage fill:#ffffff,stroke:#cbd5e1,stroke-width:2px,color:#0f172a
    style Workers fill:#ffffff,stroke:#cbd5e1,stroke-width:2px,color:#0f172a

    classDef card fill:#ffffff,stroke:#94a3b8,stroke-width:1.5px,color:#0f172a
    class UI,API,Relay,PG,Redis,ES,Worker,SMTP,Slack card
```

---

## Core Technical Implementations

### 1. Transactional Outbox Pattern & No-Cron Scheduling
Rather than running recurring cron jobs that poll the database every minute, emails are written transactionally into PostgreSQL as `SCHEDULED` with an `enqueuedAt = NULL` outbox marker.
- An in-process relay detects unqueued emails and enqueues corresponding **BullMQ delayed jobs** where `delay = scheduledAt - Date.now()`.
- BullMQ uses Redis sorted sets (`zadd`) to track due timestamps and transitions jobs to the active queue the millisecond their target time arrives.
- This guarantees sub-second execution fidelity without database polling overhead.

### 2. Zero-Duplicate Send Guarantees
Email duplicates are prevented at multiple architectural layers:
1. **Batch Ingestion**: Client requests require an `Idempotency-Key` header. Requests with the same key and payload hash return the existing campaign.
2. **Atomic Worker Claim**: Workers execute `UPDATE "Email" SET status = 'PROCESSING' WHERE id = :id AND status = 'SCHEDULED'`. If another worker concurrently claimed the row, `count === 0` and the job is discarded.
3. **Ambiguous Delivery Quarantine**: If an SMTP timeout occurs *after* transmitting message data, the email is quarantined to `FAILED` with an audit notice rather than retried, preventing duplicate deliveries to real recipients.

### 3. Atomic Redis Lua Rate Limiting & UTC Hour Windowing
Rate limits are calculated across fixed **UTC clock hours** (`YYYY-MM-DD-HH`):
- Both the sender limit and the campaign limit are checked atomically using an embedded **Redis Lua script** ([backend/src/rate-limit.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/rate-limit.ts)).
- The script uses `redis.call('TIME')` rather than Node.js system time, eliminating distributed server clock skew.
- If a quota is exceeded, the worker calls `job.moveToDelayed(nextHourTimestamp)` and raises a `DelayedError`. The job automatically re-enters the active queue at the top of the next hour without dropping messages.

### 4. Encrypted Multi-Sender SMTP (AES-256-GCM)
Users can register multiple SMTP sender identities (configured for Ethereal test accounts):
- Passwords are encrypted before database insertion using **AES-256-GCM** with a 96-bit initialization vector and 128-bit authentication tag ([backend/src/crypto.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/crypto.ts)).
- The database stores `iv:authTag:ciphertext`. Senders' raw credentials are never returned by API responses.

### 5. Slack Real-Time Quota Alerts (OAuth 2.0)
- Supports user-driven Slack connection via OAuth 2.0 with the `incoming-webhook` scope.
- When an atomic rate limit check discovers a sender has hit their hourly quota, a background notification task issues a structured Slack block alert to the connected channel with retry backoff.

### 6. Elasticsearch 8 Dual-Write Synchronization
- Every email scheduled or updated is mirrored into Elasticsearch 8 with document versioning (`version: email.version`).
- The inbox search interface delegates complex subject and recipient queries directly to Elasticsearch with fallback to PostgreSQL.

---

## Tech Stack

| Component | Technologies & Libraries |
| :--- | :--- |
| **Backend API** | TypeScript, Express 5, Node.js 22+, Helmet, Zod, Cookie-Parser |
| **Database & ORM** | PostgreSQL 16, Prisma ORM (Client v6) |
| **Distributed Queues** | Redis 7 (AOF enabled), BullMQ v5, Custom Redis Lua Scripts |
| **Search Engine** | Elasticsearch 8.15 (`@elastic/elasticsearch`) |
| **Email Protocol** | Nodemailer, Ethereal SMTP with TLS/STARTTLS verification |
| **Frontend Dashboard** | React 19, TypeScript, Vite, Tailwind CSS, Lucide React Icons |
| **Queue Observability** | Bull Board (`@bull-board/api`, `@bull-board/express`) |
| **Authentication & Security** | Google OAuth 2.0 (PKCE), Slack OAuth 2.0, AES-256-GCM encryption |

---

## Prerequisites

Before running the application, make sure you have installed:

* **Node.js**: v22+ (verified on Node 22 and Node 24)
* **npm**: v10+
* **Docker & Docker Compose**: Docker Desktop with Linux container engine running

---

## Step-by-Step Installation & Setup

### Step 1: Clone Repository & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/Bhanu-partap-13/Outbox-assesment.git
cd Outbox-assesment

# Install all workspace dependencies (root, backend, frontend)
npm install
```

---

### Step 2: Environment Configuration

Copy the sample environment file to create `.env`:

```bash
cp .env.example .env
```

Generate secure random secrets:

```bash
# Generate 32-byte hex string (for JWT_SECRET and QUEUE_ADMIN_PASSWORD)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate 64-hex-character string (for ENCRYPTION_KEY)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Verify or update the following values in `.env`:

```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173
API_URL=http://localhost:5173

# Security keys
JWT_SECRET=your_32_character_random_string_here
ENCRYPTION_KEY=your_64_hex_character_encryption_key_here

# Services
DATABASE_URL=postgresql://scheduler:scheduler@localhost:5432/scheduler?schema=public
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=reachinbox-emails

# Throttling defaults
WORKER_CONCURRENCY=5
MAX_EMAILS_PER_HOUR=200
MIN_DELAY_BETWEEN_EMAILS_MS=2000
EMAIL_MAX_ATTEMPTS=3

# Google OAuth Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Slack OAuth Credentials
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret

# Queue Admin
QUEUE_ADMIN_USER=admin
QUEUE_ADMIN_PASSWORD=your_queue_admin_password
```

---

### Step 3: Google OAuth 2.0 Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Under **APIs & Services > OAuth consent screen**:
   - Set User Type to **External**.
   - Fill in App name and developer email.
   - Add your test Google account under **Test users**.
4. Under **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - Select **Web application**.
   - Add the Authorized Redirect URI:
     ```text
     http://localhost:5173/api/auth/google/callback
     ```
5. Copy the **Client ID** and **Client Secret** into your `.env`.

---

### Step 4: Slack OAuth App & Webhook Setup

1. Open the [Slack API Apps Console](https://api.slack.com/apps) and click **Create New App** (From scratch).
2. Choose your development workspace.
3. Under **Features > OAuth & Permissions**:
   - Add the Redirect URL:
     ```text
     http://localhost:5173/api/integrations/slack/callback
     ```
   - Under **Scopes > Bot Token Scopes**, add `incoming-webhook`.
4. Under **Settings > Basic Information**, copy the **Client ID** and **Client Secret** into your `.env`.

---

### Step 5: Launch Backing Infrastructure (Docker)

Start the PostgreSQL, Redis, and Elasticsearch containers in detached mode:

```bash
docker compose up -d
```

Verify that all three containers are healthy:

```bash
docker ps
```

You should see:
- `postgres:16-alpine` on port `5432` (healthy)
- `redis:7-alpine` on port `6379` (healthy)
- `elasticsearch:8.15.1` on port `9200` (healthy)

---

### Step 6: Database Initialization & Migrations

Generate the Prisma Client and apply the database schema:

```bash
# Generate the Prisma client
npm run db:generate

# Deploy migrations to PostgreSQL
npm run db:migrate
```

*(Optional: If working on a fresh database without historical migrations, you can also push schema directly with `npm run db:push`)*.

---

## Running the Application

### Option A: One-Command All-in-One Runner (Recommended)

Start the Backend API, the BullMQ Worker, and the Vite Frontend together with one command:

```bash
npm run dev
```

This concurrently launches:
* **Backend API**: `http://localhost:4000`
* **BullMQ Queue Worker**: Concurrently processing jobs with concurrency = 5
* **Frontend Web App**: `http://localhost:5173`

---

### Option B: Separate Terminals for Debugging

For separate log observation:

**Terminal 1 — Backend API Server:**
```bash
npm run dev --workspace backend
```

**Terminal 2 — BullMQ Queue Worker:**
```bash
npm run worker --workspace backend
```

**Terminal 3 — Frontend React Application:**
```bash
npm run dev --workspace frontend
```

---

## Application Access Endpoints

| Service / Tool | URL | Description |
| :--- | :--- | :--- |
| **Frontend Web App** | [http://localhost:5173](http://localhost:5173) | Main user interface (Inbox, Senders, Compose) |
| **Backend API Health** | [http://localhost:4000/api/health](http://localhost:4000/api/health) | Basic ping endpoint (`{"ok": true}`) |
| **Readiness Check** | [http://localhost:4000/api/ready](http://localhost:4000/api/ready) | Verifies PostgreSQL, Redis, and Elasticsearch |
| **Bull Board Queue Monitor** | [http://localhost:5173/admin/queues](http://localhost:5173/admin/queues) | Visual BullMQ job monitoring dashboard |
| **Backend Direct Queue Admin** | [http://localhost:4000/admin/queues](http://localhost:4000/admin/queues) | Direct backend Bull Board endpoint |

---

## Step-by-Step Demo & Verification Walkthrough (5-Minute Flow)

Follow this end-to-end walkthrough to verify all core project requirements:

### 1. User Authentication
1. Open [http://localhost:5173](http://localhost:5173) in your browser.
2. Click **Login with Google**.
3. Complete the Google consent screen. Upon redirect, the dashboard displays your Google user name, email address, and avatar.

### 2. Add Ethereal SMTP Senders
1. Open [Ethereal Email](https://ethereal.email/create) in another tab to generate two free test accounts.
2. In the dashboard, click **Compose New Email** > **Add Sender** (or click the sender dropdown).
3. Enter:
   - **Sender Name**: e.g. `Acme Growth Team`
   - **Ethereal Email Address**
   - **Ethereal Password**
   - **Hourly Limit**: `2` (set to 2 for quick demonstration of rate throttling)
4. Click **Save Sender**. The backend tests SMTP credentials via STARTTLS before encrypting the secret with AES-256-GCM.
5. Repeat to add a second sender.

### 3. Connect Slack for Rate Alerts
1. Click **Connect Slack** in the sidebar.
2. Authorize the application and select your target Slack channel.
3. The dashboard sidebar now displays **Slack connected** with your selected channel.

### 4. Compose & Schedule Email Batch
1. Click **Compose New Email**.
2. Upload a sample CSV file or paste addresses into the recipient area:
   ```csv
   email
   john.doe@example.com
   jane.smith@example.com
   john.doe@example.com
   alex.jones@example.com
   ```
3. Notice that the lead parser detects **3 unique recipients** and automatically discards duplicate entries.
4. Fill in:
   - **Subject**: `Product Roadmap & Q4 Updates`
   - **Body**: Plain text email content
   - **Start Time**: 1 minute from now
   - **Delay Between Emails**: `2000` ms (2 seconds)
   - **Batch Hourly Cap**: `2`
5. Click **Schedule Emails**.

### 5. Test Rate Limiting & Live Slack Notification
1. Open the [Bull Board Dashboard](http://localhost:5173/admin/queues) to inspect the 3 delayed jobs in the queue.
2. When the scheduled time arrives:
   - Email 1 is sent.
   - Email 2 is sent (reaching the hourly quota of 2).
   - Email 3 is atomically postponed using `moveToDelayed` to the beginning of the next UTC hour.
3. Check your Slack channel: a live webhook notification appears stating that the sender has reached their hourly limit!

### 6. Test Server Restart Persistence
1. While jobs are queued or delayed, terminate both the backend and worker processes (`Ctrl+C`).
2. Keep Docker running (PostgreSQL and Redis AOF volumes remain intact).
3. Restart the application (`npm run dev`).
4. On startup, the outbox reconciliation runs: **no jobs are duplicated or lost**, and execution resumes seamlessly.

### 7. Fast Search & Email Previews
1. Go to the **Sent** view in the inbox table.
2. Type a subject or recipient keyword into the search bar — searches run against **Elasticsearch 8** with sub-50ms latency.
3. Click on any sent email row to open the details modal and click the **Ethereal Preview Link** to view the delivered email in Ethereal.

---

## Automated Testing & Production Builds

### Run Unit Tests
Verifies batch scheduling calculations, CSV parsing & deduplication, timezone normalization, and input validation:

```bash
npm test
```

### Run Integration Tests
Runs live Redis Lua rate limiting tests against the running Redis container:

```bash
npm run test:integration --workspace backend
```

### Run Production Builds
Validates TypeScript typings and builds production assets for both frontend and backend:

```bash
npm run build
```

---

## Architectural Decisions & Trade-Offs

| Decision | Rationale | Trade-Off Considered |
| :--- | :--- | :--- |
| **BullMQ Delayed Jobs vs. Cron Polling** | Delayed jobs schedule individual executions in Redis sorted sets. Workers wake up only when work is due, eliminating database polling and high cron jitter. | Requires Redis availability; mitigated by PostgreSQL outbox recovery on restart. |
| **Redis Lua for Rate Limiting** | Atomically decrements quotas and enforces delays using Redis server time in a single execution. Prevents race conditions with multi-worker concurrency. | Complex logic in Lua; isolated with comprehensive unit and integration test coverage. |
| **Quarantine Ambiguous SMTP Deliveries** | If a timeout occurs after transmitting message data, retrying could send duplicate emails to real users. Such emails are flagged as `FAILED` for review. | Requires manual inspection for transient SMTP drops, prioritizing zero-duplicate safety over blind retries. |
| **Fixed UTC Clock Hour Quota Windows** | Hourly limits reset at `YYYY-MM-DD-HH:00:00Z`. Predictable for senders and matches standard email provider quota policies. | Burst sending at the end of an hour window resets at the next hour; controlled by minimum inter-message delays. |

---

## REST API Documentation

### 1. Ingestion: Schedule Email Batch
`POST /api/emails/schedule`

**Headers:**
* `Content-Type: application/json`
* `Idempotency-Key`: Unique UUID (8–128 characters)

**Request Body:**
```json
{
  "senderId": "cm3abc1230000xyz",
  "recipients": ["user1@example.com", "user2@example.com"],
  "subject": "Platform Maintenance Notice",
  "body": "Hi there,\nPlease note our scheduled maintenance window.",
  "startAt": "2026-11-01T10:00:00.000Z",
  "delayMs": 2000,
  "hourlyLimit": 200
}
```

### 2. Senders Management
* `GET /api/senders` — List configured senders with current hour usage counters.
* `POST /api/senders` — Add and verify a new Ethereal SMTP sender with STARTTLS check.

### 3. Emails & Search
* `GET /api/emails?status=SCHEDULED&page=1&limit=25` — List scheduled emails with pagination.
* `GET /api/emails?status=SENT&query=Maintenance` — Search sent emails with Elasticsearch 8.
* `GET /api/emails/counts` — Retrieve real-time counter summary (`{ scheduled: number, sent: number }`).

### 4. Integrations
* `GET /api/integrations/slack` — Check current Slack connection status.
* `GET /api/integrations/slack/connect` — Initiate Slack OAuth 2.0 flow.
* `DELETE /api/integrations/slack` — Disconnect Slack integration.

---

## Troubleshooting & FAQs

#### 1. Express 5 Wildcard Routing (`Missing parameter name at index 1: *`)
* **Symptom**: `PathError [TypeError]: Missing parameter name at index 1: *` on backend startup.
* **Explanation**: Express 5 uses `path-to-regexp` v6+. Bare asterisks (`app.get('*')`) are invalid.
* **Solution**: Express 5 requires named wildcard parameters (e.g. `app.get('/*splat', ...)`), which is already configured in [server.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/server.ts).

#### 2. Worker Startup Error: `Redis unavailable`
* **Symptom**: `Redis unavailable; requests remain in the database outbox` when starting worker.
* **Solution**: Ensure your Docker containers have finished starting up and are healthy (`docker ps`) before launching `npm run worker`.

#### 3. Windows Prisma DLL Lock (`EPERM` Error)
* **Symptom**: `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`.
* **Solution**: Stop running Node/tsx processes (`Ctrl+C` in dev terminals) before executing `npm run db:generate`.

#### 4. Frontend Shows "The server is unavailable. Please retry"
* **Solution**: This indicates the backend on port 4000 is not running. Check your backend terminal for errors and ensure `http://localhost:4000/api/health` returns `{"ok": true}`.

---

## Project Structure

```text
├── backend/
│   ├── prisma/             # PostgreSQL Prisma schema & migrations
│   ├── src/
│   │   ├── auth.ts         # Google OAuth & session cookie management
│   │   ├── config.ts       # Zod-validated environment configuration
│   │   ├── crypto.ts       # AES-256-GCM encryption & decryption
│   │   ├── db.ts           # Prisma client singleton
│   │   ├── notifications.ts# Slack rate alert delivery with retry
│   │   ├── queue.ts        # BullMQ queue & Redis client
│   │   ├── rate-limit.ts   # Redis Lua throttling script
│   │   ├── relay.ts        # Transactional outbox synchronization relay
│   │   ├── routes/         # Express REST API routes (emails, senders, oauth)
│   │   ├── scheduling.ts   # Timezone-aware batch scheduling engine
│   │   ├── search.ts       # Elasticsearch client & document sync
│   │   ├── server.ts       # Express app & Bull Board middleware entry
│   │   └── worker.ts       # BullMQ processor & SMTP delivery loop
│   └── test/               # Scheduling unit tests & Redis integration tests
├── frontend/
│   ├── src/
│   │   ├── components/     # Inbox, Compose, SenderDialog, Login, UI components
│   │   ├── api.ts          # Type-safe backend API client
│   │   ├── leads.ts        # CSV & raw text lead parsing and deduplication
│   │   ├── main.tsx        # React 19 application root
│   │   └── styles.css      # Custom styling & Tailwind utilities
│   └── test/               # Lead parser & timezone unit tests
├── docker-compose.yml      # PostgreSQL 16, Redis 7 (AOF), Elasticsearch 8.15
├── package.json            # Root workspace definitions & unified scripts
└── README.md               # Complete project documentation
```

---

## Assignment Compliance Matrix

| Requirement | Implementation Status | Evidence / Location |
| :--- | :--- | :--- |
| **TypeScript, Express, PostgreSQL, BullMQ, Redis** | Complete | Production builds & Prisma types pass |
| **No Cron Polling for Dispatch** | Complete | BullMQ delayed jobs via `startRelay` in [relay.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/relay.ts) |
| **Bulk Email Scheduling API** | Complete | `POST /api/emails/schedule` with idempotency & batch transactions |
| **Multi-Sender SMTP (Ethereal)** | Complete | Encrypted at rest with AES-256-GCM in [crypto.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/crypto.ts) |
| **Server Restart Persistence** | Complete | PostgreSQL outbox + Redis AOF persistence |
| **Zero Duplicate Sends** | Complete | Atomic row claims & ambiguous SMTP quarantine in [worker.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/worker.ts) |
| **Configurable Concurrency** | Complete | `WORKER_CONCURRENCY` env option in [worker.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/worker.ts) |
| **Delay and Hourly Rate Caps** | Complete | Atomic Redis Lua script in [rate-limit.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/rate-limit.ts) |
| **Overflow Delayed to Next Hour** | Complete | `moveToDelayed(nextHour)` via BullMQ in [worker.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/worker.ts) |
| **Slack Real OAuth 2.0 & Live Alerts** | Complete | OAuth in [oauth.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/routes/oauth.ts) & alerts in [notifications.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/notifications.ts) |
| **Elasticsearch 8 for Search** | Complete | Versioned sync and fast query in [search.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/search.ts) |
| **Live Bull Board Dashboard** | Complete | Basic auth queue monitoring at `/admin/queues` |
| **Real Google Login with PKCE** | Complete | Audience verification & HTTP-only cookies in [auth.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/backend/src/auth.ts) |
| **Lead Parser & Duplicate Chips** | Complete | CSV/text parser with deduplication chips in [leads.ts](file:///e:/Users/Ritesh%20Sinha/Desktop/PROJECTS/BHANU%20ASSESMENT/frontend/src/leads.ts) |

---

## Submission & Evaluation

* **Repository**: [https://github.com/Bhanu-partap-13/Outbox-assesment](https://github.com/Bhanu-partap-13/Outbox-assesment)
* **Author**: Bhanu Partap (`Bhanu-partap-13`)
* **Reviewers**: Mitrajit, Yadav036

# Assignment compliance and verification

Source: the full user-supplied Notion assignment pasted on 2026-10-24. The screenshot is a design reference, not authorization to publish or submit anything.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| TypeScript, Express, PostgreSQL, BullMQ/Redis | Implemented | Production build and Prisma validation pass |
| No cron | Delayed BullMQ jobs; outbox relay only | Code checked |
| Bulk scheduling API | Transactional campaign and email rows, idempotency key | Validation/time calculations tested; live DB pending |
| Multiple senders, Ethereal | Verified credentials, encrypted storage, sender picker | Live credentials pending |
| Restart persistence | AOF Redis volume, database outbox, startup reconciliation | Docker engine unavailable; restart demo pending |
| No duplicate email sends | Atomic claim, deterministic job ID, ambiguous SMTP quarantine | Live crash tests pending; SMTP caveat documented |
| Configurable concurrency | Worker environment setting | Compiles; load test pending |
| Delay and hourly caps | Redis Lua, sender/campaign counters, global spacing | Integration test included; real Redis run pending |
| Hourly overflow delayed | moveToDelayed + DelayedError | Compiles; live boundary test pending |
| Slack real OAuth | Per-user incoming-webhook connection; state validation | OAuth credentials and consent pending |
| Live Slack rate alert | HTTPS POST with durable retry and deduplication | Required live demonstration pending |
| Slack disconnect/reconnect | DB state read at send time; local disconnect route | Code implemented; live test pending |
| Elasticsearch for scheduled/sent | Versioned indexing, tenant/status filtering | Schema/queries compile; live ES pending |
| Live BullMQ dashboard | Bull Board, admin authentication | Live queue pending |
| Real Google login | Authorization code, PKCE, verified ID token | Google credentials and consent pending |
| Header identity/logout | User name/email/avatar and logout | UI fixtures checked |
| Reference UI | White/green inbox and separate compose view | Approximate reference alignment; exact Figma fidelity incomplete |
| CSV/text lead upload and detected count | File parsing, deduplication, chips/count | Parser tests pass |
| Subject, body, start, delay, hourly limit | Compose form wired to schedule API | Browser fixture flow passes |
| Scheduled and sent/failed views | Pagination, details, loading/empty/error states | Browser fixtures checked |
| Clean reusable frontend structure | Components, types, API, parser split | TypeScript build passes |
| README/setup/trade-offs | Included | Reviewed |
| Private GitHub and requested collaborators | Not performed | Needs repository creation and access decisions |
| Five-minute demo | Script included | Actual recording pending |
| Submission form | Not submitted | Requires user review and final details |

The project is not submission-ready until the pending live OAuth, SMTP, Slack, persistence, and queue checks are completed. Test fixtures are not evidence of those integrations.

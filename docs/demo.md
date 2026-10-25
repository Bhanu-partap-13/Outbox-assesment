# Five-minute demo guide

Only record after Google/Slack app credentials, Ethereal senders, and Docker services are configured. Never display secrets, cookie values, SMTP passwords, or webhook URLs.

1. **0:00–0:40 — Login.** Open the real app entry, complete real Google OAuth, and show the returned name/email/avatar. Do not use the development UI fixture.
2. **0:40–1:20 — Senders and Slack.** Show two saved Ethereal senders. Click Connect Slack, complete Slack consent, and show the selected workspace/channel in the dashboard.
3. **1:20–2:10 — Schedule.** Upload a short CSV containing three addresses including one duplicate (or four rows for three unique recipients). Show the detected count. Pick a sender, subject, body, start one minute ahead, delay 2 seconds, hourly limit 2.
4. **2:10–3:10 — Restart.** Show the scheduled rows and delayed jobs in Bull Board. Stop only the API/worker, then start them again. Leave Redis and PostgreSQL volumes intact. Show the original jobs remain and no new campaign appears.
5. **3:10–4:10 — Delivery and alert.** Show two SENT rows and their Ethereal preview links. Show the real Slack message arriving when the cap is hit. Show the third job delayed to the next UTC hour, without failure or lost rows.
6. **4:10–4:40 — Search.** Search a subject using the real Elasticsearch-backed API, then clear search and open a message.
7. **4:40–5:00 — Explain the boundary.** Briefly state the per-hour UTC window, concurrency configuration, and the uncertain-SMTP quarantine trade-off.

Use a fresh sender or wait for the next UTC hour if earlier test sends already consumed the sender's quota. Do not reset rate-limit keys during the demonstration.

## Submission checklist

- Create a private repository under the intended GitHub account.
- Grant the requested reviewers Mitrajit and Yadav036 access.
- Confirm no .env, tokens, or SMTP credentials are tracked.
- Push the coherent local commits.
- Record the real application demonstration above.
- Review the repository/video links before submitting the assignment form.

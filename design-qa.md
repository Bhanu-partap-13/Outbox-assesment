# Design and interaction QA

final result: blocked

## Evidence

- Source visual truth: `docs/reference.png`, supplied by the user (1477 × 492 pixels). The seven desktop frames are approximately 340 × 213 pixels each.
- Implementation: `docs/screenshots/inbox.jpg`, `compose.jpg`, `login.jpg` (1360 × 852 viewport captures), and `mobile.jpg` (390 × 844).
- Browser: Codex in-app browser. Tests used the explicitly separate `frontend/test/preview.html` fixture; no production authentication was bypassed.
- The source board and inbox implementation were opened together in one comparison input. Large-frame proportions were assessed at the approximately 4:1 frame scale. No claim of pixel-perfect typography is made from the small source frames.
- Focused checks: sidebar width/selected row, recipient chips, delay/hourly fields, schedule popover, login card, and mobile message view were inspected in rendered captures and accessibility snapshots.
- Browser console: no warning/error entries in the tested fixture.

## Findings

- [P2] Exact source fidelity remains incomplete.
  Evidence: the source uses a branded mark, Google logo, rich formatting toolbar, and attachment thumbnails. The implementation uses a text wordmark, a sign-in icon, and a plain-text editor; there are no synthetic attachments.
  Impact: this is a functional interpretation of the required Notion flow, not a faithful reproduction of every screenshot detail.
  Fix: obtain the original Figma assets and full-resolution frames; implement rich-content behavior and source branding if those visual details are required for final acceptance.
- [P2] Live provider and infrastructure states remain unverified.
  Evidence: Google/Slack app credentials are unset, and Docker's Linux engine stopped during startup.
  Impact: UI fixtures cannot prove real login, delivery, Slack notification, queue recovery, or Elasticsearch behavior.
  Fix: configure the real provider apps, start the infrastructure, and run the demo checklist.

## Required fidelity surfaces

- **Fonts/typography:** Arial/Helvetica system sans, compact 10–15px interface text. General hierarchy aligns with the source; exact font and weights are unconfirmed at source resolution.
- **Spacing/layout:** the 220px sidebar at 1360px closely matches the source proportions; the full-page compose layout, sender/recipient rows, and top-right scheduler are present. The required user header adds vertical space relative to the reference.
- **Colors/tokens:** white background, green outline actions, pale green selection, muted gray text, orange scheduled badge.
- **Image quality/assets:** Google avatars render from authenticated profile URLs; fixture avatars use a standard user icon. Source branding and attachment artwork are not reproduced. This prevents a strict fidelity pass.
- **Copy/content:** required Scheduled/Sent, Compose New Email, user identity, sender, recipients, subject, body, delay, hourly cap, and scheduling controls are present. Fixtures contain fictional sample records. Password login from the reference is intentionally omitted in favor of the assignment's required real Google login.

## Interaction checks

Passed in the fixture: searching to an empty state; clearing search; opening compose; entering two recipients and observing two chips/count; entering subject/body; opening and closing Send later; submitting and seeing two new rows and a confirmation; switching to Sent; opening a message; reading the mobile layout at 390px.

CSV parsing, deduplication, local-time conversion, and backend batch validation/time calculations pass automated tests. Real file upload through the browser was not exercised. Real OAuth, SMTP, Slack, PostgreSQL, Elasticsearch, and Redis checks remain pending.

## Comparison history

1. Replaced the original dark card dashboard with the white/green inbox layout from the reference.
2. Captured inbox and compose at desktop proportions and compared the source board and implementation together.
3. Captured mobile message detail and login. No viewport overflow or browser errors were observed. The source-asset and live-integration findings above remain unresolved.

## Remaining checklist

1. Configure provider apps and Ethereal senders; start Docker infrastructure.
2. Run real queue/rate/restart/search checks and the Slack notification demonstration.
3. Resolve original Figma assets and rich-content scope, then repeat strict visual comparison.

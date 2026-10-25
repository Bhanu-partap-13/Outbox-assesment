// Development-only visual test harness. This entry is not part of the production build.
// It never authenticates a user, talks to a backend, or sends messages.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from '../src/App';
import Login from '../src/components/Login';
import '../src/styles.css';

const user = { id: 'qa-user', name: 'Oliver Brown', email: 'oliver@example.com', avatar: null };
const sender = { id: 'qa-sender', name: 'Oliver Brown', email: 'oliver@ethereal.email', hourlyLimit: 200 };
let scheduled = [
  { id: 'qa-1', to: 'alex@example.com', subject: 'A quick introduction', body: 'Hi Alex,\n\nI thought you might find our new product useful. Would you be open to a short conversation?\n\nBest,\nOliver', scheduledAt: '2026-10-25T04:00:00Z', sentAt: null, status: 'SCHEDULED', sender, error: null, previewUrl: null },
  { id: 'qa-2', to: 'sam@example.com', subject: 'Following up on our conversation', body: 'Hi Sam, here are the next steps we discussed.', scheduledAt: '2026-10-25T04:00:02Z', sentAt: null, status: 'SCHEDULED', sender, error: null, previewUrl: null },
];
const sent = [{ ...scheduled[0], id: 'qa-sent', status: 'SENT', sentAt: '2026-10-24T03:30:00Z' }];
window.fetch = async (url, options) => {
  const path = new URL(String(url), location.origin);
  const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
  if (path.pathname === '/api/auth/config') return json({ google: true });
  if (path.pathname === '/api/emails/counts') return json({ scheduled: scheduled.length, sent: sent.length });
  if (path.pathname === '/api/integrations/slack') return json({ configured: false, connection: null });
  if (path.pathname === '/api/senders') return json({ items: [sender], minDelayMs: 2000, maxHourlyLimit: 200 });
  if (path.pathname === '/api/emails/schedule') {
    const data = JSON.parse(String(options?.body));
    const rows = data.recipients.map((to: string, i: number) => ({ ...scheduled[0], id: 'qa-new-' + i, to, subject: data.subject, body: data.body, scheduledAt: data.startAt }));
    scheduled = [...scheduled, ...rows];
    return json({ count: rows.length }, 202);
  }
  if (path.pathname.startsWith('/api/emails/')) {
    const rows = path.pathname.endsWith('/sent') ? sent : scheduled;
    const q = path.searchParams.get('q')?.toLowerCase() ?? '';
    const items = rows.filter(row => (row.to + ' ' + row.subject).toLowerCase().includes(q));
    return json({ items, total: items.length, page: 1, pageSize: 25 });
  }
  return json({ message: 'This action requires the real configured backend.' }, 503);
};
createRoot(document.getElementById('root')!).render(<React.StrictMode>{new URLSearchParams(location.search).has('login') ? <Login /> : <Workspace user={user} onLogout={() => { location.href = '/'; }} />}</React.StrictMode>);

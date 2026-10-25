import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Inbox as InboxIcon, Search, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '../api';
import type { Email, EmailPage } from '../types';
import { Alert, formatDate, Loading, Status } from './ui';

export default function Inbox({ view, refreshKey }: { view: 'scheduled' | 'sent'; refreshKey: number }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<EmailPage | null>(null);
  const [selected, setSelected] = useState<Email | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => { setSelected(null); setPage(1); }, [view]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api<EmailPage>('/emails/' + view + '?q=' + encodeURIComponent(query) + '&page=' + page, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setResult(data); })
        .catch(e => { if (!controller.signal.aborted) setError(e.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, query, page, refreshKey, reload]);
  useEffect(() => { const timer = setInterval(() => setReload(value => value + 1), 15000); return () => clearInterval(timer); }, []);

  if (selected) return <article className="email-detail">
    <header><button className="icon-button" aria-label="Back to emails" onClick={() => setSelected(null)}><ArrowLeft size={18} /></button><h1>{selected.subject}</h1><Status status={selected.status} /></header>
    <div className="email-meta"><div><strong>{selected.sender.name}</strong><span> &lt;{selected.sender.email}&gt;</span><p>To: {selected.to}</p></div><time>{formatDate(selected.sentAt ?? selected.scheduledAt)}</time></div>
    {selected.error && <Alert>{selected.error}</Alert>}
    <div className="email-body">{selected.body}</div>
    {selected.previewUrl && <a className="text-button" href={selected.previewUrl} target="_blank" rel="noreferrer">Open in Ethereal <ExternalLink size={14} /></a>}
  </article>;
  return <section className="inbox-content" aria-label={view === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}>
    <div className="inbox-toolbar"><div className="search-field"><Search size={16} /><input aria-label="Search emails" placeholder="Search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></div>
      <button className="icon-button" aria-label="Refresh emails" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></button>
    </div>
    {error && <div className="inbox-error"><Alert>{error}</Alert><button className="text-button" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
    {loading && !result ? <Loading /> : !error && result && result.items.length === 0 ? <div className="empty-state"><InboxIcon size={28} /><h2>{query ? 'No matching emails' : view === 'scheduled' ? 'No scheduled emails' : 'No sent emails yet'}</h2><p>{query ? 'Try another recipient or subject.' : view === 'scheduled' ? 'Compose an email to schedule your first delivery.' : 'Your sent and failed deliveries will appear here.'}</p></div> :
      !error && result && <><div className="mail-list" aria-busy={loading}>{result.items.map(email =>
        <button className="mail-row" key={email.id} onClick={() => setSelected(email)}>
          <span className="mail-recipient">To: {email.to}</span><Status status={email.status} />
          <span className="mail-preview"><strong>{email.subject}</strong><span> — {email.body.replace(/\s+/g, ' ')}</span></span>
          <time>{formatDate(view === 'scheduled' ? email.scheduledAt : email.sentAt)}</time>
        </button>)}</div><div className="pagination"><span>{result.total} emails</span><button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></button><span>Page {page}</span><button className="icon-button" aria-label="Next page" disabled={page * result.pageSize >= result.total} onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></button></div></>}
  </section>;
}

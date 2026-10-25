import { useEffect, useState } from 'react';
import { Clock3, Send, LogOut, ChevronDown, Plus, Menu, ServerCog, Unplug } from 'lucide-react';
import { api, ApiError } from './api';
import type { SlackStatus, User } from './types';
import Login from './components/Login';
import Compose from './components/Compose';
import Inbox from './components/Inbox';
import { Alert, Avatar, Loading } from './components/ui';

export function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<'scheduled' | 'sent'>('scheduled');
  const [compose, setCompose] = useState(false);
  const [menu, setMenu] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [counts, setCounts] = useState({ scheduled: 0, sent: 0 });
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const loadSlack = () => api<SlackStatus>('/integrations/slack').then(setSlack).catch(e => setError(e.message));
  useEffect(() => { void loadSlack(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('slack') === 'connected') setNotice('Slack connected. Rate-limit alerts are enabled.');
    if (params.get('slackError')) setError(params.get('slackError') === 'not_configured'
      ? 'Slack setup is pending. Add the Slack app credentials to enable connection.'
      : 'Slack connection failed. Please try again.');
    if (params.has('slack') || params.has('slackError')) history.replaceState(null, '', location.pathname);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => api<typeof counts>('/emails/counts', { signal: controller.signal }).then(setCounts).catch(() => {});
    void load(); const timer = setInterval(load, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refreshKey]);
  async function disconnect() {
    try { await api('/integrations/slack', { method: 'DELETE' }); await loadSlack(); setNotice('Slack disconnected.'); }
    catch (e) { setError((e as Error).message); }
  }
  if (compose) return <Compose onClose={() => setCompose(false)} onScheduled={count => {
    setCompose(false); setView('scheduled'); setRefreshKey(key => key + 1); setNotice(count + ' emails scheduled.');
  }} />;
  return <div className="workspace">
    <aside className={'sidebar ' + (menu ? 'sidebar-open' : '')}>
      <div className="wordmark" aria-label="Outbox Labs">OUTBOX LABS</div>
      <div className="sidebar-account"><Avatar user={user} /><div><strong>{user.name}</strong><span>{user.email}</span></div><ChevronDown size={13} /></div>
      <button className="compose-button" onClick={() => setCompose(true)}><Plus size={15} />Compose New Email</button>
      <div className="nav-caption">MAIL</div>
      <nav>
        <button className={'nav-link ' + (view === 'scheduled' ? 'active' : '')} onClick={() => { setView('scheduled'); setMenu(false); }}><Clock3 size={15} /><span>Scheduled</span><span>{counts.scheduled}</span></button>
        <button className={'nav-link ' + (view === 'sent' ? 'active' : '')} onClick={() => { setView('sent'); setMenu(false); }}><Send size={15} /><span>Sent</span><span>{counts.sent}</span></button>
      </nav>
      <div className="sidebar-bottom">
        {slack?.connection ? <div className="slack-connection"><span>Slack connected</span><small>{slack.connection.channel}</small><button className="text-button" onClick={disconnect}><Unplug size={13} />Disconnect</button><a href="/api/integrations/slack/connect">Reconnect Slack</a></div>
          : <a className="nav-link" href="/api/integrations/slack/connect"><Plus size={15} /><span>Connect Slack</span></a>}
        <a className="nav-link" href="/admin/queues" target="_blank" rel="noreferrer"><ServerCog size={15} /><span>Queue monitor</span></a>
        <button className="nav-link" onClick={onLogout}><LogOut size={15} /><span>Log out</span></button>
      </div>
    </aside>
    <div className="main-column">
      <header className="account-header"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMenu(!menu)}><Menu size={20} /></button>
        <span className="page-label">{view === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}</span>
        <div className="header-user"><div><strong>{user.name}</strong><span>{user.email}</span></div><Avatar user={user} /><button className="icon-button" aria-label="Log out" onClick={onLogout}><LogOut size={16} /></button></div>
      </header>
      {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
      {error && <Alert>{error}</Alert>}
      <Inbox view={view} refreshKey={refreshKey} />
    </div>
  </div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    api<User>('/me').then(setUser).catch(e => {
      if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
    }).finally(() => setLoading(false));
  }, []);
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); setUser(null); }
    catch (e) { setError((e as Error).message); }
  }
  if (loading) return <Loading label="Opening your workspace…" />;
  if (!user) return <>{error && <Alert>{error}</Alert>}<Login /></>;
  return <>{error && <Alert>{error}</Alert>}<Workspace user={user} onLogout={() => void logout()} /></>;
}

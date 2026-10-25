import type { ReactNode } from 'react';
import { LoaderCircle, UserRound, X } from 'lucide-react';
import type { EmailStatus, User } from '../types';

export function Loading({ label = 'Loading emails…' }: { label?: string }) {
  return <div className="loading" role="status"><LoaderCircle size={18} className="spin" />{label}</div>;
}
export function Alert({ children }: { children: ReactNode }) {
  return <div className="alert" role="alert">{children}</div>;
}
export function Avatar({ user }: { user: User }) {
  return user.avatar ? <img className="avatar" src={user.avatar} alt="" referrerPolicy="no-referrer" />
    : <span className="avatar avatar-fallback"><UserRound size={18} /></span>;
}
export function Status({ status }: { status: EmailStatus }) {
  const label = { SCHEDULED: 'Scheduled', PROCESSING: 'Sending', SENT: 'Sent', FAILED: 'Failed' }[status];
  return <span className={'status status-' + status.toLowerCase()}>{label}</span>;
}
export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="dialog-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}
export function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
}

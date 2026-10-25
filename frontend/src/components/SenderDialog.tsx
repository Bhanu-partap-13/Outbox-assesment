import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Sender } from '../types';
import { Alert, Dialog } from './ui';

export default function SenderDialog({ maxLimit, onClose, onSaved }: {
  maxLimit: number; onClose: () => void; onSaved: (sender: Sender) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const sender = await api<Sender>('/senders', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), email: form.get('email'), password: form.get('password'), hourlyLimit: Number(form.get('hourlyLimit')),
      }) });
      onSaved(sender);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title="Connect an email sender" onClose={onClose}>
    <form onSubmit={submit} className="dialog-form">
      <p className="muted">Use an account from <a href="https://ethereal.email/create" target="_blank" rel="noreferrer">Ethereal Email</a>. Messages stay in its test inbox.</p>
      <label>Sender name<input name="name" required maxLength={100} autoFocus placeholder="Your name" /></label>
      <label>Ethereal email<input name="email" type="email" required placeholder="you@ethereal.email" /></label>
      <label>SMTP password<input name="password" type="password" required autoComplete="new-password" /></label>
      <label>Hourly limit<input name="hourlyLimit" type="number" min={1} max={maxLimit} defaultValue={maxLimit} required /></label>
      {error && <Alert>{error}</Alert>}
      <div className="dialog-actions"><button type="button" className="button-quiet" onClick={onClose}>Cancel</button><button className="button-solid" disabled={busy}>{busy ? 'Verifying…' : 'Connect sender'}</button></div>
    </form>
  </Dialog>;
}

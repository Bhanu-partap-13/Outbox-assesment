import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarClock, Plus, Upload, X } from 'lucide-react';
import { api } from '../api';
import { localDateTime, parseLeads } from '../leads';
import type { SenderSettings } from '../types';
import SenderDialog from './SenderDialog';
import { Alert, Loading } from './ui';

export default function Compose({ onClose, onScheduled }: { onClose: () => void; onScheduled: (count: number) => void }) {
  const [settings, setSettings] = useState<SenderSettings | null>(null);
  const [senderId, setSenderId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startAt, setStartAt] = useState(() => localDateTime(new Date(Date.now() + 10 * 60000)));
  const [delay, setDelay] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showSender, setShowSender] = useState(false);
  const [fileInfo, setFileInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    api<SenderSettings>('/senders').then(data => {
      setSettings(data); setSenderId(data.items[0]?.id ?? '');
      setDelay(data.minDelayMs / 1000); setHourlyLimit(data.items[0]?.hourlyLimit ?? data.maxHourlyLimit);
    }).catch(e => setError(e.message));
  }, []);
  const sender = settings?.items.find(item => item.id === senderId);
  const detected = [...new Set([...recipients, ...parseLeads(to)])];
  const maxLimit = sender?.hourlyLimit ?? settings?.maxHourlyLimit ?? 200;

  async function importFile(file?: File) {
    if (!file) return;
    setError('');
    if (!/\.(csv|txt)$/i.test(file.name) || file.size > 2_000_000) { setError('Upload a CSV or text file smaller than 2 MB.'); return; }
    const found = parseLeads(await file.text());
    if (!found.length) { setError('No valid email addresses were found in this file.'); return; }
    if (found.length > 10000) { setError('A batch supports up to 10,000 unique email addresses.'); return; }
    setRecipients(current => [...new Set([...current, ...found])]);
    setFileInfo(file.name + ': ' + found.length + ' unique addresses detected');
  }
  async function schedule(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!senderId) { setError('Connect and select an Ethereal sender first.'); return; }
    if (!detected.length || detected.length > 10000) { setError('Add between 1 and 10,000 valid email addresses.'); return; }
    if (!subject.trim() || !body.trim()) { setError('Enter a subject and message.'); return; }
    if (!startAt || new Date(startAt).getTime() <= Date.now()) { setShowSchedule(true); setError('Choose a future start time.'); return; }
    const payload = JSON.stringify({ senderId, recipients: detected, subject, body, startAt: new Date(startAt).toISOString(), delayMs: Math.round(delay * 1000), hourlyLimit });
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await api<{ count: number }>('/emails/schedule', { method: 'POST', body: payload, headers: { 'Idempotency-Key': request.current.key } });
      onScheduled(result.count);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="compose-page">
    <header className="compose-header">
      <button className="back-button" onClick={onClose} disabled={busy}><ArrowLeft size={18} />Compose New Email</button>
      <div className="compose-actions">
        <button className="icon-button" aria-label="Choose schedule time" aria-expanded={showSchedule} onClick={() => setShowSchedule(!showSchedule)}><CalendarClock size={18} /></button>
        <button className="button-outline" form="compose-form" type="submit" disabled={busy}>{busy ? 'Scheduling…' : 'Schedule'}</button>
      </div>
    </header>
    <form id="compose-form" className="compose-form" onSubmit={schedule}>
      {error && <Alert>{error}</Alert>}
      {!settings && !error && <Loading label="Loading senders…" />}
      <div className="compose-line"><label htmlFor="sender">From</label>
        <select id="sender" value={senderId} onChange={e => {
          setSenderId(e.target.value);
          setHourlyLimit(settings?.items.find(item => item.id === e.target.value)?.hourlyLimit ?? 200);
        }}><option value="">Select a sender</option>{settings?.items.map(item => <option key={item.id} value={item.id}>{item.name} &lt;{item.email}&gt;</option>)}</select>
        <button type="button" className="text-button" onClick={() => setShowSender(true)}><Plus size={14} />Add sender</button>
      </div>
      <div className="compose-line recipient-line"><label htmlFor="recipients">To</label>
        <div className="recipients">
          {recipients.slice(0, 8).map(email => <span className="recipient-chip" key={email}>{email}<button type="button" onClick={() => setRecipients(items => items.filter(item => item !== email))} aria-label={'Remove ' + email}><X size={11} /></button></span>)}
          {recipients.length > 8 && <span className="recipient-more">+{recipients.length - 8} more</span>}
          <input id="recipients" placeholder="recipient@example.com" value={to} onChange={e => setTo(e.target.value)} onBlur={() => {
            if (parseLeads(to).length) { setRecipients(detected); setTo(''); }
          }} />
        </div>
        <button type="button" className="text-button" onClick={() => upload.current?.click()}><Upload size={14} />Upload list</button>
        <input ref={upload} className="sr-only" type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Upload leads file" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {(detected.length > 0 || fileInfo) && <div className="lead-count" role="status">{detected.length} unique recipients{fileInfo && <span> · {fileInfo}</span>}<button type="button" className="text-button" onClick={() => { setRecipients([]); setTo(''); setFileInfo(''); }}>Clear list</button></div>}
      <div className="compose-line"><label htmlFor="subject">Subject</label><input id="subject" placeholder="Subject" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} /></div>
      <div className="delivery-settings">
        <label>Delay between emails <input type="number" min={(settings?.minDelayMs ?? 2000) / 1000} max={86400} step="0.1" value={delay} onChange={e => setDelay(Number(e.target.value))} required /> seconds</label>
        <label>Hourly limit <input type="number" min={1} max={maxLimit} value={hourlyLimit} onChange={e => setHourlyLimit(Number(e.target.value))} required /></label>
      </div>
      <div className="message-editor">
        <label className="sr-only" htmlFor="body">Message body</label>
        <textarea id="body" placeholder="Type your reply here…" value={body} onChange={e => setBody(e.target.value)} maxLength={100000} />
        <div className="editor-footer"><span>Plain text</span><span>{body.length.toLocaleString()} characters</span></div>
      </div>
      <div className="schedule-summary"><CalendarClock size={14} />Starts {new Date(startAt).toLocaleString()}<button type="button" className="text-button" onClick={() => setShowSchedule(true)}>Change</button></div>
    </form>
    {showSchedule && <section className="schedule-popover" aria-label="Send later">
      <h2>Send later</h2>
      <label>Start time<input type="datetime-local" value={startAt} min={localDateTime(new Date())} onChange={e => setStartAt(e.target.value)} /></label>
      <p className="muted">Your local time · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
      <button className="schedule-preset" onClick={() => setStartAt(localDateTime(new Date(Date.now() + 3600000)))}>In one hour</button>
      <button className="schedule-preset" onClick={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); setStartAt(localDateTime(tomorrow)); }}>Tomorrow, 9:00 AM</button>
      <div className="dialog-actions"><button className="button-outline" onClick={() => setShowSchedule(false)}>Done</button></div>
    </section>}
    {showSender && <SenderDialog maxLimit={settings?.maxHourlyLimit ?? 200} onClose={() => setShowSender(false)} onSaved={newSender => {
      setSettings(current => current ? { ...current, items: [...current.items.filter(item => item.id !== newSender.id), newSender] } : current);
      setSenderId(newSender.id); setHourlyLimit(newSender.hourlyLimit); setShowSender(false);
    }} />}
  </div>;
}

export type User = { id: string; name: string; email: string; avatar: string | null };
export type Sender = { id: string; name: string; email: string; hourlyLimit: number };
export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED';
export type Email = {
  id: string; to: string; subject: string; body: string; scheduledAt: string;
  sentAt: string | null; status: EmailStatus; error: string | null; sender: Sender;
  previewUrl: string | null;
};
export type EmailPage = { items: Email[]; total: number; page: number; pageSize: number };
export type SenderSettings = { items: Sender[]; minDelayMs: number; maxHourlyLimit: number };
export type SlackStatus = { configured: boolean; connection: { teamName: string; channel: string } | null };

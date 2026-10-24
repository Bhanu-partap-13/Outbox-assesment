import { Client } from '@elastic/elasticsearch';
import type { Email } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';

export const searchClient = new Client({ node: config.ELASTICSEARCH_URL, requestTimeout: 5000, maxRetries: 0 });
export async function ensureSearchIndex() {
  if (await searchClient.indices.exists({ index: config.ELASTICSEARCH_INDEX })) return;
  try {
    await searchClient.indices.create({ index: config.ELASTICSEARCH_INDEX, mappings: { properties: {
      id: { type: 'keyword' }, userId: { type: 'keyword' }, status: { type: 'keyword' },
      to: { type: 'text' }, subject: { type: 'text' }, body: { type: 'text' }, sender: { type: 'text' },
      createdAt: { type: 'date' }, scheduledAt: { type: 'date' }, sentAt: { type: 'date' },
    } } });
  } catch (error) {
    if (!(await searchClient.indices.exists({ index: config.ELASTICSEARCH_INDEX }))) throw error;
  }
}
export async function indexEmail(email: Email & { sender: { email: string } }) {
  await searchClient.index({ index: config.ELASTICSEARCH_INDEX, id: email.id,
    version: email.version, version_type: 'external_gte', refresh: 'wait_for',
    document: { id: email.id, userId: email.userId, to: email.to, subject: email.subject, body: email.body,
      sender: email.sender.email, status: email.status, createdAt: email.createdAt,
      scheduledAt: email.scheduledAt, sentAt: email.sentAt },
  });
  await prisma.email.updateMany({ where: { id: email.id, version: email.version },
    data: { indexedVersion: email.version } });
}
export async function repairSearchIndex() {
  await ensureSearchIndex();
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Email" WHERE "indexedVersion" < version ORDER BY "createdAt" LIMIT 100`;
  const emails = await prisma.email.findMany({ where: { id: { in: rows.map(row => row.id) } }, include: { sender: { select: { email: true } } } });
  // External document versions protect against concurrent relays writing stale state.
  await Promise.allSettled(emails.map(indexEmail));
}
export async function searchEmails(userId: string, q: string, statuses: string[], page: number, pageSize: number) {
  const result = await searchClient.search<{ id: string }>({
    index: config.ELASTICSEARCH_INDEX, track_total_hits: true,
    query: { bool: { must: [{ multi_match: { query: q, fields: ['to', 'subject^2', 'body', 'sender'] } }],
      filter: [{ term: { userId } }, { terms: { status: statuses } }] } },
    sort: [{ scheduledAt: 'desc' }, { id: 'asc' }], from: (page - 1) * pageSize, size: pageSize,
  });
  return { ids: result.hits.hits.map(hit => hit._id!).filter(Boolean),
    total: typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value ?? 0 };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { reserveSend } from '../../src/rate-limit.js';

test('real Redis serializes permits, enforces sender and campaign limits, and survives new connections', async () => {
  const connection = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
  const id = 'test-' + randomUUID();
  const input = { senderId: id, campaignId: id, senderLimit: 2, campaignLimit: 10, minDelayMs: 1, delayMs: 1 };
  try {
    await connection.ping();
    const first = await reserveSend(connection, input);
    assert.equal(first.allowed, true);
    await new Promise(resolve => setTimeout(resolve, 5));
    const results = await Promise.all(Array.from({ length: 50 }, () => reserveSend(connection, input)));
    assert.equal(results.filter(result => result.allowed).length, 1);
    assert.ok(results.some(result => result.reached));
    const reconnected = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    try {
      const denied = await reserveSend(reconnected, input);
      assert.equal(denied.allowed, false);
      assert.equal(denied.reached, true);
      assert.ok(denied.retryAt > Date.now());
    } finally { await reconnected.quit(); }
    const other = await reserveSend(connection, { ...input, senderId: id + '-other', campaignId: id + '-other', senderLimit: 100, campaignLimit: 1 });
    assert.equal(other.allowed, true); assert.equal(other.reached, true); assert.equal(other.limit, 1);
  } finally {
    // Remove only exact test keys. Never flush the user's Redis database.
    const hour = Math.floor(Date.now() / 3600000);
    await connection.del('rates:sender:' + id + ':' + hour, 'rates:campaign:' + id + ':' + hour,
      'rates:sender-gap:' + id, 'rates:sender:' + id + '-other:' + hour,
      'rates:campaign:' + id + '-other:' + hour, 'rates:sender-gap:' + id + '-other');
    await connection.quit();
  }
});

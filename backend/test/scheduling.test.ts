import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, requestHash, scheduleTimes } from '../src/scheduling.js';

const request = {
  senderId: 'sender-1', recipients: ['person@example.com', 'PERSON@example.com', 'other@example.com'],
  subject: 'Hello', body: 'A real message', startAt: '2026-11-01T09:30:00+05:30', delayMs: 1, hourlyLimit: 3,
};
test('normalizes duplicate leads and enforces the configured minimum delay', () => {
  const result = normalizeSchedule(request, 2000);
  assert.deepEqual(result.recipients, ['person@example.com', 'other@example.com']);
  assert.equal(result.delayMs, 2000);
});
test('preserves timezone and delay for a 1000-recipient batch', () => {
  const times = scheduleTimes(request.startAt, 1000, 2000);
  assert.equal(times[0].toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(times[999].getTime() - times[0].getTime(), 999 * 2000);
});
test('rejects invalid recipients, oversized batches, and non-positive limits', () => {
  assert.throws(() => normalizeSchedule({ ...request, recipients: ['bad'] }, 2000));
  assert.throws(() => normalizeSchedule({ ...request, recipients: Array(10001).fill('a@example.com') }, 2000));
  assert.throws(() => normalizeSchedule({ ...request, hourlyLimit: 0 }, 2000));
  assert.throws(() => normalizeSchedule({ ...request, delayMs: -1 }, 2000));
});
test('request hash changes when content changes and is stable on retries', () => {
  assert.equal(requestHash(request), requestHash({ ...request }));
  assert.notEqual(requestHash(request), requestHash({ ...request, subject: 'Different' }));
});

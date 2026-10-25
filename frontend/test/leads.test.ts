import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeads, localDateTime } from '../src/leads';

test('extracts CSV and text leads without headers and deduplicates addresses', () => {
  assert.deepEqual(parseLeads('Name,Email\nAlice,ALICE@example.com\nBob,bob+demo@example.co.uk\n\"Alice\",alice@example.com'),
    ['alice@example.com', 'bob+demo@example.co.uk']);
});
test('ignores malformed input and accepts display-name recipients', () => {
  assert.deepEqual(parseLeads('Name <hello@example.com>; nope@; broken@@; @example.com'), ['hello@example.com']);
});
test('local datetime field round trips with no UTC offset shift', () => {
  const source = new Date(2026, 9, 24, 15, 30);
  assert.equal(new Date(localDateTime(source)).getTime(), source.getTime());
});

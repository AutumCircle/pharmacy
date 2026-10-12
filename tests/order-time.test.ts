import assert from 'node:assert/strict';
import test from 'node:test';

import { formatOrderDate, formatOrderDateTime, parseOrderTime } from '../src/lib/order-time.ts';

test('UTC, offset and legacy UTC without suffix show the same Dushanbe time', () => {
  const expected = '12.10.2026, 00:30';
  assert.equal(formatOrderDateTime('2026-10-11T19:30:00Z'), expected);
  assert.equal(formatOrderDateTime('2026-10-12T00:30:00+05:00'), expected);
  assert.equal(formatOrderDateTime('2026-10-11T19:30:00'), expected);
});

test('Dushanbe date crosses midnight before UTC', () => {
  assert.equal(formatOrderDate('2026-10-11T19:30:00Z'), '12.10.2026');
  assert.equal(parseOrderTime('2026-10-11T19:30:00').toISOString(), '2026-10-11T19:30:00.000Z');
});

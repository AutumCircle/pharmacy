import assert from 'node:assert/strict';
import test from 'node:test';

import { clientAddress, createFixedWindowLimiter } from '../src/lib/rate-limit.ts';

const T = 1_700_000_000_000;

test('allows up to the limit and refuses the next request', () => {
  const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 3; i += 1) {
    const decision = limiter.consume('a', T);
    assert.equal(decision.allowed, true);
    assert.equal(decision.retryAfterSeconds, 0);
  }
  const refused = limiter.consume('a', T);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0);
  assert.ok(refused.retryAfterSeconds <= 60);
});

test('retryAfterSeconds shrinks as the window elapses and stays within range', () => {
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
  assert.equal(limiter.consume('a', T).allowed, true);
  const early = limiter.consume('a', T + 1);
  assert.equal(early.allowed, false);
  assert.equal(early.retryAfterSeconds, 60);
  const late = limiter.consume('a', T + 59_500);
  assert.equal(late.allowed, false);
  assert.equal(late.retryAfterSeconds, 1);
});

test('keys are independent', () => {
  const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 3; i += 1) assert.equal(limiter.consume('a', T).allowed, true);
  assert.equal(limiter.consume('a', T).allowed, false);
  assert.equal(limiter.consume('b', T).allowed, true);
});

test('window resets after windowMs', () => {
  const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 3; i += 1) limiter.consume('a', T);
  assert.equal(limiter.consume('a', T + 59_999).allowed, false);
  assert.equal(limiter.consume('a', T + 60_000).allowed, true);
});

test('refused requests do not extend or consume the window', () => {
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 60_000, maxKeys: 100 });
  limiter.consume('a', T);
  limiter.consume('a', T);
  for (let i = 0; i < 10; i += 1) assert.equal(limiter.consume('a', T + 30_000).allowed, false);
  assert.equal(limiter.consume('a', T + 60_000).allowed, true);
  assert.equal(limiter.consume('a', T + 60_000).allowed, true);
  assert.equal(limiter.consume('a', T + 60_000).allowed, false);
});

test('maxKeys caps memory and expired entries are pruned', () => {
  const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 2 });
  assert.equal(limiter.consume('a', T).allowed, true);
  assert.equal(limiter.consume('b', T).allowed, true);
  const refused = limiter.consume('c', T);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 60);
  // Existing keys keep working while the cap is reached.
  assert.equal(limiter.consume('a', T).allowed, true);
  assert.equal(limiter.consume('c', T + 59_999).allowed, false);
  // Once 'a' and 'b' expire they are pruned and the new key fits.
  assert.equal(limiter.consume('c', T + 60_000).allowed, true);
  assert.equal(limiter.consume('d', T + 60_000).allowed, true);
  assert.equal(limiter.consume('e', T + 60_000).allowed, false);
});

test('checkout policy: one order plus two retries and a correction pass at limit 5', () => {
  const limiter = createFixedWindowLimiter({ limit: 5, windowMs: 10 * 60_000, maxKeys: 10_000 });
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.consume('1.2.3.4', T + i * 1_000).allowed, true);
  const refused = limiter.consume('1.2.3.4', T + 5_000);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 600);
  assert.equal(limiter.consume('1.2.3.4', T + 10 * 60_000).allowed, true);
});

test('clientAddress uses the first x-forwarded-for entry', () => {
  const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'x-real-ip': '9.9.9.9' });
  assert.equal(clientAddress(headers), '1.2.3.4');
});

test('clientAddress falls back to x-real-ip', () => {
  assert.equal(clientAddress(new Headers({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
});

test('clientAddress falls back to the shared unknown bucket', () => {
  assert.equal(clientAddress(new Headers()), 'unknown');
  assert.equal(clientAddress(new Headers({ 'x-forwarded-for': ' , ' })), 'unknown');
});

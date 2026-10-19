import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRACKING_BLOCK_MS,
  TRACKING_MAX_KEYS,
  TRACKING_RATE_LIMIT,
  TRACKING_RATE_WINDOW_MS,
  TRACKING_SCRAPE_DISTINCT_PHONES,
  TRACKING_SCRAPE_WINDOW_MS,
  createTrackingGuard,
  type TrackingGuardOptions,
} from '../src/lib/tracking-guard.ts';

const T = 1_700_000_000_000;
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.9';
const PHONES = ['900000001', '900000002', '900000003', '900000004', '900000005', '900000006'];

function guard(overrides: Partial<TrackingGuardOptions> = {}) {
  return createTrackingGuard({
    rateLimit: TRACKING_RATE_LIMIT,
    rateWindowMs: TRACKING_RATE_WINDOW_MS,
    scrapeDistinctPhones: TRACKING_SCRAPE_DISTINCT_PHONES,
    scrapeWindowMs: TRACKING_SCRAPE_WINDOW_MS,
    blockMs: TRACKING_BLOCK_MS,
    maxKeys: TRACKING_MAX_KEYS,
    ...overrides,
  });
}

test('exported constants match the owner decision', () => {
  assert.equal(TRACKING_RATE_LIMIT, 5);
  assert.equal(TRACKING_RATE_WINDOW_MS, 60_000);
  assert.equal(TRACKING_SCRAPE_DISTINCT_PHONES, 5);
  assert.equal(TRACKING_SCRAPE_WINDOW_MS, 60_000);
  assert.equal(TRACKING_BLOCK_MS, 5 * 60 * 60 * 1000);
  assert.equal(TRACKING_MAX_KEYS, 10_000);
});

test('same number: 5 per minute allowed, 6th rate limited, never blocked', () => {
  const g = guard();
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(g.check(IP, PHONES[0], T + i * 1000), { allowed: true, retryAfterSeconds: 0 });
  }
  const refused = g.check(IP, PHONES[0], T + 5_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.allowed === false && refused.code, 'RATE_LIMITED');
  assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 60);
  assert.equal(g.inspect(IP).blockedUntil, null);

  assert.equal(g.check(IP, PHONES[0], T + 60_000).allowed, true);
  assert.equal(g.inspect(IP).blockedUntil, null);
});

test('five distinct numbers within a minute block the IP for 5 hours; other IPs unaffected', () => {
  const g = guard();
  for (let i = 0; i < 4; i += 1) {
    assert.equal(g.check(IP, PHONES[i], T + i * 10_000).allowed, true);
  }
  const blockAt = T + 40_000;
  const blocked = g.check(IP, PHONES[4], blockAt);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.code, 'TRACKING_BLOCKED');
  assert.ok(Math.abs(blocked.retryAfterSeconds - 18_000) <= 1);
  assert.equal(g.check(OTHER_IP, PHONES[4], blockAt).allowed, true);

  for (const offset of [1, 60_000, 60 * 60 * 1000, TRACKING_BLOCK_MS - 1]) {
    const decision = g.check(IP, PHONES[0], blockAt + offset);
    assert.equal(decision.allowed, false);
    assert.equal(decision.allowed === false && decision.code, 'TRACKING_BLOCKED');
    assert.ok(decision.retryAfterSeconds >= 1);
    assert.equal(g.check(OTHER_IP, PHONES[0], blockAt + offset).allowed, true);
  }

  assert.equal(g.check(IP, PHONES[0], blockAt + TRACKING_BLOCK_MS).allowed, true);
  assert.equal(g.inspect(IP).blockedUntil, null);
});

test('distinct numbers spread beyond the window do not block', () => {
  const g = guard();
  for (let i = 0; i < 4; i += 1) {
    assert.equal(g.check(IP, PHONES[i], T + i * 1000).allowed, true);
  }
  const fifth = g.check(IP, PHONES[4], T + 61_000);
  assert.equal(fifth.allowed, true);
  assert.equal(g.inspect(IP).blockedUntil, null);
});

test('rate-limited lookups still record their phone digest', () => {
  const g = guard();
  // Use up the per-minute quota on one number.
  for (let i = 0; i < 5; i += 1) assert.equal(g.check(IP, PHONES[0], T).allowed, true);
  // Further distinct numbers are rate limited but still counted.
  for (let i = 1; i < 4; i += 1) {
    const decision = g.check(IP, PHONES[i], T + i);
    assert.equal(decision.allowed === false && decision.code, 'RATE_LIMITED');
  }
  const fifth = g.check(IP, PHONES[4], T + 10);
  assert.equal(fifth.allowed === false && fifth.code, 'TRACKING_BLOCKED');
});

test('guard stores only phone digests, never the raw number', () => {
  const g = guard();
  g.check(IP, PHONES[0], T);
  g.check(IP, PHONES[1], T + 1);
  const { phoneKeys } = g.inspect(IP);
  assert.equal(phoneKeys.length, 2);
  for (const key of phoneKeys) {
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes(PHONES[0]));
    assert.ok(!key.includes(PHONES[1]));
  }
  assert.ok(!JSON.stringify(g.inspect(IP)).includes(PHONES[0]));
});

test('per-IP digest list stays bounded and drops entries older than the window', () => {
  const g = guard();
  for (let i = 0; i < 4; i += 1) g.check(IP, PHONES[i], T + i);
  assert.equal(g.inspect(IP).phoneKeys.length, 4);
  g.check(IP, PHONES[4], T + 70_000);
  assert.equal(g.inspect(IP).phoneKeys.length, 1);
});

test('full block map evicts the block that expires first instead of refusing new clients', () => {
  const g = guard({ maxKeys: 2, rateLimit: 100 });
  function scrape(ip: string, at: number) {
    let last = g.check(ip, PHONES[0], at);
    for (let i = 1; i < 5; i += 1) last = g.check(ip, PHONES[i], at);
    assert.equal(last.allowed === false && last.code, 'TRACKING_BLOCKED');
  }
  scrape('a', T);
  scrape('b', T + 1_000);
  scrape('c', T + 2_000);
  // 'a' expires first and was evicted; 'b' and 'c' remain blocked.
  assert.equal(g.inspect('a').blockedUntil, null);
  assert.equal(g.check('a', PHONES[0], T + 3_000).allowed, true);
  assert.equal(g.check('b', PHONES[0], T + 3_000).allowed, false);
  assert.equal(g.check('c', PHONES[0], T + 3_000).allowed, false);
});

test('phone tracker memory stays bounded under many IPs', () => {
  const g = guard({ maxKeys: 3, rateLimit: 100 });
  for (let i = 0; i < 10; i += 1) g.check(`10.0.0.${i}`, PHONES[0], T);
  let tracked = 0;
  for (let i = 0; i < 10; i += 1) if (g.inspect(`10.0.0.${i}`).phoneKeys.length > 0) tracked += 1;
  assert.ok(tracked <= 3);
  // New clients are still served (fail open), apart from the per-minute limiter's own cap.
  assert.equal(g.inspect('10.0.0.9').phoneKeys.length, 1);
});

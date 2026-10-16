// Pure tracking-lookup guard: per-IP rate limit plus a scrape block for clients that
// look up many different phone numbers in a short time. Kept free of Next.js imports and
// `@/` aliases so `node --test` can import it directly.
//
// Storage is in memory per server instance (Option A): counters and blocks are lost on
// cold start/redeploy and are not shared between instances. A durable store can replace
// this module later behind the same `TrackingGuard.check` interface.

import { createHmac, randomBytes } from 'node:crypto';
import { createFixedWindowLimiter } from './rate-limit.ts';

/** Maximum tracking lookups per IP within one rate window. */
export const TRACKING_RATE_LIMIT = 5;
export const TRACKING_RATE_WINDOW_MS = 60_000;
/** Distinct phone numbers per IP within the scrape window that start a block. */
export const TRACKING_SCRAPE_DISTINCT_PHONES = 5;
export const TRACKING_SCRAPE_WINDOW_MS = 60_000;
/** Length of the scrape block. */
export const TRACKING_BLOCK_MS = 5 * 60 * 60 * 1000;
/** Memory cap for each per-IP map. */
export const TRACKING_MAX_KEYS = 10_000;

export type TrackingGuardDecision =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; code: 'RATE_LIMITED' | 'TRACKING_BLOCKED'; retryAfterSeconds: number };

export interface TrackingGuardOptions {
  rateLimit: number;
  rateWindowMs: number;
  scrapeDistinctPhones: number;
  scrapeWindowMs: number;
  blockMs: number;
  maxKeys: number;
  /** HMAC key for phone digests; random per process when omitted. */
  hmacKey?: Buffer;
}

export interface TrackingGuardSnapshot {
  /** Stored phone digests for the IP (never raw phones). */
  phoneKeys: string[];
  blockedUntil: number | null;
}

export interface TrackingGuard {
  check(ip: string, phoneNormalized: string, now: number): TrackingGuardDecision;
  /** Read-only view of the state held for one IP (for tests and diagnostics). */
  inspect(ip: string): TrackingGuardSnapshot;
}

function retryAfter(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

export function createTrackingGuard(options: TrackingGuardOptions): TrackingGuard {
  const { scrapeDistinctPhones, scrapeWindowMs, blockMs, maxKeys } = options;
  const hmacKey = options.hmacKey ?? randomBytes(32);
  const limiter = createFixedWindowLimiter({
    limit: options.rateLimit,
    windowMs: options.rateWindowMs,
    maxKeys,
  });
  // ip -> (phone digest -> last seen timestamp); at most `scrapeDistinctPhones` entries each.
  const recentPhones = new Map<string, Map<string, number>>();
  // ip -> blockedUntil timestamp.
  const blocks = new Map<string, number>();

  function digest(phoneNormalized: string): string {
    return createHmac('sha256', hmacKey).update(phoneNormalized).digest('hex');
  }

  function pruneBlocks(now: number): void {
    for (const [ip, until] of blocks) {
      if (until <= now) blocks.delete(ip);
    }
  }

  function dropStalePhones(phones: Map<string, number>, now: number): void {
    for (const [hash, seenAt] of phones) {
      if (now - seenAt >= scrapeWindowMs) phones.delete(hash);
    }
  }

  function prunePhones(now: number): void {
    for (const [ip, phones] of recentPhones) {
      dropStalePhones(phones, now);
      if (phones.size === 0) recentPhones.delete(ip);
    }
  }

  function startBlock(ip: string, now: number): number {
    pruneBlocks(now);
    if (!blocks.has(ip) && blocks.size >= maxKeys) {
      // Fail open: evict the block that expires first instead of refusing new clients.
      let victim: string | null = null;
      let earliest = Number.POSITIVE_INFINITY;
      for (const [key, until] of blocks) {
        if (until < earliest) {
          earliest = until;
          victim = key;
        }
      }
      if (victim !== null) blocks.delete(victim);
    }
    const until = now + blockMs;
    blocks.set(ip, until);
    recentPhones.delete(ip);
    return until;
  }

  /** Records the phone digest; returns true when this makes the IP a scraper. */
  function recordPhone(ip: string, phoneNormalized: string, now: number): boolean {
    let phones = recentPhones.get(ip);
    if (!phones) {
      if (recentPhones.size >= maxKeys) prunePhones(now);
      if (recentPhones.size >= maxKeys) {
        // Still full: drop the oldest-inserted IP so memory stays bounded.
        const oldest = recentPhones.keys().next().value;
        if (oldest !== undefined) recentPhones.delete(oldest);
      }
      phones = new Map<string, number>();
      recentPhones.set(ip, phones);
    } else {
      dropStalePhones(phones, now);
    }
    const hash = digest(phoneNormalized);
    phones.delete(hash);
    phones.set(hash, now);
    return phones.size >= scrapeDistinctPhones;
  }

  return {
    check(ip: string, phoneNormalized: string, now: number): TrackingGuardDecision {
      const blockedUntil = blocks.get(ip);
      if (blockedUntil !== undefined) {
        if (blockedUntil > now) {
          return { allowed: false, code: 'TRACKING_BLOCKED', retryAfterSeconds: retryAfter(blockedUntil, now) };
        }
        blocks.delete(ip);
      }

      // Record before the per-minute limit so rate-limited lookups still count as distinct numbers.
      if (recordPhone(ip, phoneNormalized, now)) {
        const until = startBlock(ip, now);
        return { allowed: false, code: 'TRACKING_BLOCKED', retryAfterSeconds: retryAfter(until, now) };
      }

      const decision = limiter.consume(ip, now);
      if (!decision.allowed) {
        return { allowed: false, code: 'RATE_LIMITED', retryAfterSeconds: decision.retryAfterSeconds };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },

    inspect(ip: string): TrackingGuardSnapshot {
      const phones = recentPhones.get(ip);
      return {
        phoneKeys: phones ? [...phones.keys()] : [],
        blockedUntil: blocks.get(ip) ?? null,
      };
    },
  };
}

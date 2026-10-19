// Pure, dependency-free fixed-window rate limiter. Kept free of Next.js imports and
// `@/` aliases so `node --test` can import it directly.

export interface FixedWindowLimiterOptions {
  /** Maximum allowed requests per key within one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum number of tracked keys; new keys are refused once reached. */
  maxKeys: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the caller may retry; 0 when allowed. */
  retryAfterSeconds: number;
}

export interface FixedWindowLimiter {
  consume(key: string, now: number): RateLimitDecision;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export function createFixedWindowLimiter(options: FixedWindowLimiterOptions): FixedWindowLimiter {
  const { limit, windowMs, maxKeys } = options;
  const entries = new Map<string, WindowEntry>();

  function prune(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }

  function retryAfter(resetAt: number, now: number): number {
    return Math.max(1, Math.ceil((resetAt - now) / 1000));
  }

  function earliestReset(): number {
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of entries.values()) {
      if (entry.resetAt < earliest) earliest = entry.resetAt;
    }
    return earliest;
  }

  return {
    consume(key: string, now: number): RateLimitDecision {
      prune(now);
      const current = entries.get(key);
      if (!current) {
        if (entries.size >= maxKeys) {
          // Memory cap reached: refuse new clients until the oldest window expires.
          const earliest = earliestReset();
          const resetAt = Number.isFinite(earliest) ? earliest : now + windowMs;
          return { allowed: false, retryAfterSeconds: retryAfter(resetAt, now) };
        }
        if (limit <= 0) {
          return { allowed: false, retryAfterSeconds: retryAfter(now + windowMs, now) };
        }
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count >= limit) {
        return { allowed: false, retryAfterSeconds: retryAfter(current.resetAt, now) };
      }
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/**
 * Best-effort client address: first `x-forwarded-for` entry, then `x-real-ip`,
 * otherwise the shared `'unknown'` bucket (fails closed for header-less clients).
 */
export function clientAddress(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')?.trim()
    || 'unknown';
}

VERDICT: PASS

Reviewed `git diff main...factory/006-tracking-scrape-block` (route, guard, client-reads, tracking page, tests, API_CONTRACT, package.json, tsconfig.json).

## Findings (blocking)
None.

Checked and OK:
- Boundary: no SQL or DB access added. The route still goes through `trackPublicOrders` (server-only path to API Gateway and Lambda). No Lambda or migration change.
- Secrets: no credentials, tokens or `.env*` in the diff. No new `NEXT_PUBLIC_*`. The HMAC key is `randomBytes(32)` per process and never leaves the server (`src/lib/tracking-guard.ts:56`).
- Input: the body is validated before the guard (`src/app/api/tracking/route.ts:35-47`), so invalid bodies are 400 and consume nothing. The guard key is the IP only. There is no per-phone bucket, so an attacker cannot lock a victim out of their own phone.
- Abuse and enumeration: the block check runs before anything else, the 5th distinct number is refused without calling upstream (`tracking-guard.ts:142-145`), and per-minute-refused lookups still record their digest. Per-IP phone state is capped at 4 digests, and both maps are capped at `TRACKING_MAX_KEYS`, so memory is bounded.
- Privacy: phones are stored only as HMAC-SHA-256 digests and dropped after 60 s. The route, guard and error path have no `console.*`. `apiRouteError` does not echo the phone.
- XSS: the server message is rendered as a React text node in `role="alert"` (`src/app/tracking/page.tsx:192`). There is no `dangerouslySetInnerHTML`. The message is only shown for 429 from the same-origin route.
- Client cache: a rejected 429 is evicted from the dedupe map (`client-reads.ts` catch path), so the error is not stuck in the cache.
- No destructive endpoints added.

## Notes (non-blocking)
- `src/lib/rate-limit.ts:55-59` (existing code, reused at `tracking-guard.ts:57`): the per-minute limiter fails closed once 10 000 IPs are tracked. Someone with many source IPs (or spoofed `x-forwarded-for` off Vercel) could deny tracking to all new clients on an instance for up to 60 s. The spec accepts this. A follow-up could switch it to fail-open or evict the oldest key, as the block map already does.
- `tracking-guard.ts:92-103` and `114-119`: under a flood of 10 000+ IPs, the fail-open eviction lets an attacker push out a real scraper's block or reset its distinct-number counter. Doing this needs many IPs, which already beat an IP-keyed guard, so it is acceptable for Option A.
- `clientAddress` (`rate-limit.ts:80-84`) trusts the first `x-forwarded-for` entry. Vercel overwrites this header, so it is safe there. Any other hosting would make it spoofable, which would bypass both rules. This is already listed under the spec Risks.
- The rate is effectively about 4 distinct numbers per IP per minute without triggering a block (about 5 700 per day per IP), and IP rotation or a cold start bypasses it. A durable, global limit needs Option B (Lambda/RDS) and owner escalation. API_CONTRACT documents this honestly.
- `tsconfig.json` `allowImportingTsExtensions`: has no security impact.

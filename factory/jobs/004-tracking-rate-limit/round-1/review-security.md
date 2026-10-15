VERDICT: PASS

Security review: 004-tracking-rate-limit, round 1 (diff `main...factory/004-tracking-rate-limit`, commit 808d239).

## Findings

No blocking findings.

Checked:
- **Boundary:** no SQL and no DB access added. The Next.js route still calls Lambda only through `trackPublicOrders` (`src/lib/api-v1/server.ts`). No `backend/v1` or migration changes.
- **Secrets:** no `.env*`, credentials or tokens in the diff. No new `NEXT_PUBLIC_*`. `src/lib/rate-limit.ts` is pure and does not touch `API_KEY`.
- **Bypass:** `src/app/api/tracking/route.ts:43` is the only caller of `trackPublicOrders`, and the limiter at `route.ts:36` runs before it. The 429 path returns before any upstream call. Invalid bodies return 400 before quota is consumed, which is fine because they never reach Lambda.
- **Privacy:** the limiter key is the IP only (`route.ts:36`). The raw phone is not logged and not used as a key. Leaving out the per-phone bucket also avoids locking a victim out of their own tracking.
- **Memory / DoS:** the map is capped by `maxKeys` 10_000 and expired entries are pruned (`src/lib/rate-limit.ts:33-37,57-62`).
- **XSS:** the 429 `serverMessage` is rendered as React text (`src/app/tracking/page.tsx:189`), with no `dangerouslySetInnerHTML`. It is shown only for status 429. Other failures keep the generic message.
- **Destructive endpoints / SSRF / open redirect:** none introduced.

## Notes (non-blocking)

- `src/lib/rate-limit.ts:81` trusts the first `x-forwarded-for` entry. This matches the existing admin and staff login limiters, and it is safe on Vercel because the platform edge overwrites XFF. Behind any other proxy, or if the app is self-hosted, a client can set XFF to any value and get a fresh bucket per request, so the limit can be bypassed completely. The spec accepts this risk. If the deployment target ever changes, prefer the Vercel-specific `x-vercel-forwarded-for`, or the right-most trusted hop.
- The limit is per instance and resets on cold start, so it is not a global guarantee. This is documented in `API_CONTRACT.md` §7, along with the missing per-phone-hash and Lambda-side limit. A Lambda/RDS or KV counter remains the follow-up for a hard limit.
- `prune()` scans the whole map on every `consume` (`rate-limit.ts:52`), which is O(n) with n ≤ 10_000. That is acceptable at this scale. Pruning at most once per second, or only when the map is near `maxKeys`, would reduce CPU under a flood.
- Customers behind carrier NAT share one IP bucket (10 lookups per 10 minutes). This is a usability trade-off, not a security issue.

VERDICT: PASS

Security review for job 005-checkout-rate-limit, round 1. Diff reviewed: `git diff main...factory/005-checkout-rate-limit`. It touches 6 files: API_CONTRACT.md, package.json, src/app/api/checkout/route.ts, src/app/cart/page.tsx, src/lib/rate-limit.ts and tests/checkout-rate-limit.test.ts.

## Findings
None blocking.

- Boundary: no SQL and no DB access added. The checkout route still reaches the database only through `createPublicOrder`, which calls API Gateway and then Lambda. No change under backend/ or db/.
- Secrets: the diff has no credentials, tokens, `.env*` files or `NEXT_PUBLIC_*` values. `src/app/cart/page.tsx` only gains one static message string.
- AuthZ: no admin or staff surface touched.
- Input: the limiter runs after the `Idempotency-Key` check and after `isCreateOrderRequest` (src/app/api/checkout/route.ts:58), and before `cookies()` and `createPublicOrder`. A refused request makes no upstream call and sends no Telegram notification. Prices, totals and stock are still decided by Lambda, and the diff does not change that.
- Privacy: the limiter key is the IP only (`clientAddress`). Nothing new is logged, so phone, name and address are never logged.
- XSS: the error copy is shown through `setCheckoutError` as text. No `dangerouslySetInnerHTML`.
- Scope and owner constraint: `src/lib/rate-limit.ts` is imported only by the checkout route and the new test. Nothing under /api/tracking, /tracking or `client-reads.ts` changed, so the 92cb544 decision is respected.
- No destructive endpoints added.

## Notes (non-blocking)
- src/lib/rate-limit.ts:81: `clientAddress` trusts the first `x-forwarded-for` entry. On Vercel the platform sets this header, so this is acceptable. On any other host, a client could spoof it and rotate fake IPs to bypass the limit. The spec already lists this under Risks. If the app ever leaves Vercel, prefer a platform-verified IP header.
- src/lib/rate-limit.ts:56: when `maxKeys` (10,000) is full, every new IP on that instance is refused until the oldest window ends. An attacker with 10,000 or more real IPs in 10 minutes could block new customers on a warm instance. The spec requires this fail-closed behaviour, and the bound keeps memory safe, so it is accepted. A later follow-up could evict the oldest entries instead of refusing.
- src/lib/rate-limit.ts:33: `prune` scans the whole map on every consume, which costs up to 10,000 steps per checkout. That is negligible at checkout volume.
- This limit is per instance, not global (see spec Risks). The Lambda/RDS-side limit and the phone-hash limit are still gaps, and API_CONTRACT.md §11 records them correctly.

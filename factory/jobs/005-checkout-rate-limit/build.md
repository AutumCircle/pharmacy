# Build log: 005-checkout-rate-limit

## Round 1
- Commits: 6ac9e9d Checkout: per-IP rate limit on /api/checkout order creation
- Changed: src/lib/rate-limit.ts (new, byte-identical to 808d239's module), src/app/api/checkout/route.ts,
  src/app/cart/page.tsx, tests/checkout-rate-limit.test.ts (new), package.json, API_CONTRACT.md
- Limit values: CHECKOUT_RATE_LIMIT=5, CHECKOUT_RATE_WINDOW_MS=10 min, CHECKOUT_RATE_MAX_KEYS=10_000
  (named constants + comment in route.ts; documented in API_CONTRACT.md §11 and §6 step 1).
- Acceptance criteria:
  1 ✅ unit tests (limit boundary, independent keys, window reset at t+60_000, retryAfter in (0,60]).
  2 ✅ unit test: maxKeys 2 refuses 'c' while a/b active (also at t+59_999), allows it at t+60_000 after pruning.
  3 ✅ unit tests: XFF first entry, x-real-ip fallback, 'unknown' (also for blank XFF " , ").
  4 ✅ manual, `next start -p 3917` from the worktree with no API_V1_BASE_URL/API_KEY (upstream unconfigured, so
     createPublicOrder throws API_CONFIGURATION_ERROR -> 500 = "reached createPublicOrder"; nothing real can be created):
     no Idempotency-Key -> 400; invalid body -> 400 (neither consumed quota); requests 1-3 with same key k1 and
     4-5 with new keys -> 500 (reached upstream); request 6 -> 429, `retry-after: 600`, body exactly
     {"error":{"code":"RATE_LIMITED","message":"Слишком много попыток оформить заказ. Подождите несколько минут и попробуйте снова."}};
     a different XFF IP still reached upstream. Limiter runs before cookies()/createPublicOrder (code review).
  5 ✅ by code review: RATE_LIMITED added to `messages`; 429 goes through the existing non-OK branch, which only sets
     checkoutError/isSubmitting — no setPhase, clearCart, formData reset or sessionStorage removal; the pending key
     is reused on resubmit when the payload hash matches. Not clicked through in a browser.
  6 ✅ `git diff main --stat -- src/app/api/tracking src/app/tracking src/lib/api-v1/client-reads.ts` empty;
     `grep -rn "rate-limit" src tests` -> only checkout route + new test. Live: 12 POST /api/tracking from one IP
     all returned 500 (unconfigured upstream), never 429.
  7 ✅ API_CONTRACT.md §11 (values, per-instance scope, 429 + Retry-After, gap: no Lambda/phone-hash limit, tracking
     not limited) and a note under §6 algorithm step 1.
  8 ✅ see below.
- Tests run (worktree, after `npm ci`):
  - `npm run test:frontend` -> 58 pass, 0 fail (includes tests/checkout-rate-limit.test.ts, 10 tests)
  - `npm run lint` -> clean
  - `npm run build` -> success
  - Backend tests not run: backend unchanged.
- Open questions / not done: browser walkthrough of criterion 5 not performed (code review only). Limit is
  per-instance, not global (see spec Risks); §7 tracking text in API_CONTRACT.md left untouched (out of scope).

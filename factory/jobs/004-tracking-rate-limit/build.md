# Build log — 004-tracking-rate-limit

## Round 1
- Commits: 808d239 Tracking: per-IP rate limit on /api/tracking lookups
- Changed: `src/lib/rate-limit.ts` (new), `tests/tracking-rate-limit.test.ts` (new), `src/app/api/tracking/route.ts`, `src/lib/api-v1/client-reads.ts`, `src/app/tracking/page.tsx`, `API_CONTRACT.md` (§7, §11), `package.json` (`test:frontend`)
- Values: `TRACKING_RATE_LIMIT` 10, `TRACKING_RATE_WINDOW_MS` 10 min, `TRACKING_RATE_MAX_KEYS` 10_000 (unchanged from spec suggestion).
- Acceptance criteria:
  1 ✅ unit tests (limit boundary, independent keys, reset at t+60_000, retryAfter in (0,60]).
  2 ✅ unit test `maxKeys caps memory and expired entries are pruned`.
  3 ✅ unit tests for XFF first entry, x-real-ip fallback, `'unknown'` fallback (also blank XFF).
  4 ✅ manual: `next start` on port 3917 with `API_V1_BASE_URL=http://127.0.0.1:9` (rejected by `trackPublicOrders` as non-HTTPS, so no network call). 3 invalid bodies → 400; 10 valid lookups from `x-forwarded-for: 7.7.7.7` → reached `trackPublicOrders` (500 API_CONFIGURATION_ERROR); 11th → 429, `retry-after: 598`, exact RATE_LIMITED body; another IP still reaches upstream; invalid body after limit still 400. Server log contained no raw phone. Server stopped afterwards.
  5 ✅ by code review: `PublicReadError(status, serverMessage)` thrown on non-OK; page shows `serverMessage` only for status 429, otherwise «Ошибка при загрузке заказов.». Note: the existing `role="alert"` block was only rendered in the search view, but submit sets `phone` first which switches to the order-list view, so fetch errors were never visible. Added a `role="alert"` error block in the order-list panel (replacing the empty-state when `error` is set) and cleared `error` on «Сменить номер телефона». Not clicked through in a browser.
  6 ✅ `API_CONTRACT.md` §7 documents values, per-IP in-memory per-instance scope, 429 body, `Retry-After`, and the not-implemented per-phone-hash / Lambda-side limit; §11 cross-references it.
  7 ✅ see tests below; `tests/tracking-phone.test.ts` unchanged and passing.
- Tests run (in worktree, after `npm ci`):
  - `npm run test:frontend` → 56 pass, 0 fail
  - `npm run lint` → clean
  - `npm run build` → success
  - Backend tests not run (no backend change).
- Open questions / not done: limit is not global (per Vercel instance, reset on cold start) — documented; per-phone-hash bucket and Lambda/RDS or KV counter left for a follow-up per spec.

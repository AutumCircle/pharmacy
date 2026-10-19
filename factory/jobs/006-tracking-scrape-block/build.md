# Build notes: 006-tracking-scrape-block

## Round 1
- Storage decision (rework-1.md): owner chose «хранить блокировку в памяти сайта (быстро, но ненадёжно)», which is Option A. The counters and the 5-hour block live in memory per Vercel instance. There is no migration, no Lambda change and no new dependency. API_CONTRACT §7 says plainly that the block is not guaranteed (lost on cold start or redeploy, not shared between instances, bypassed by IP rotation) and that Option B (Lambda/RDS or KV) is a separate escalation.
- Commits: d757251 Tracking: per-IP lookup limit and 5-hour scrape block on /api/tracking
- Changed:
  - `src/lib/tracking-guard.ts` (new). Holds the constants and `createTrackingGuard(options)` with `check(ip, phoneNormalized, now)` and `inspect(ip)`. It reuses `createFixedWindowLimiter`. Phones are stored as HMAC-SHA-256 digests with a per-process `randomBytes` key, at most 5 per IP, and dropped after 60 s. Each map is capped at 10 000 IPs. When the block map is full, it evicts the block that expires first (fail open). When the phone map is full, it prunes stale entries and then drops the oldest-inserted IP.
  - `src/app/api/tracking/route.ts`. A module singleton runs after body validation. On refusal it returns 429 with `Retry-After` and the exact Russian bodies, and does not call upstream. Nothing is logged.
  - `src/lib/api-v1/client-reads.ts`. Adds the `PublicReadError` class (`status`, `code`, `serverMessage`). Dedupe and caching are unchanged.
  - `src/app/tracking/page.tsx`. A 429 shows the server message. In the "Мои заказы" list the error is shown in `role="alert"` instead of «У вас пока нет заказов». On error, orders and the selection are cleared. «Сменить номер телефона» clears the error. Other failures still show «Ошибка при загрузке заказов.».
  - `tests/tracking-guard.test.ts` (new) and `package.json`: the test is added to `test:frontend`.
  - `tsconfig.json`: adds `"allowImportingTsExtensions": true`. This is needed because the guard imports `./rate-limit.ts` with an extension so that `node --test` can resolve it. It is valid because `noEmit` is already set.
  - `API_CONTRACT.md` §7 and §11: documents the rules, values, IP key, hashed storage, check order, 429 bodies, Option A limitation, missing per-phone bucket and false-positive risk. The «не ограничивается (решение владельца)» line is replaced.
- Acceptance criteria:
  1. ✅ Test "same number: 5 per minute allowed, 6th rate limited, never blocked": the 6th lookup gets RATE_LIMITED with retry in 1..60, it is allowed again at t+60 000, and `blockedUntil` stays null.
  2. ✅ Test "five distinct numbers…": P1..P4 are allowed and P5 gets TRACKING_BLOCKED with retry 18 000 ± 1. P1 stays blocked at several offsets up to t+BLOCK−1 and is allowed at t+BLOCK. The other IP is allowed throughout.
  3. ✅ Test "distinct numbers spread beyond the window do not block": 4 numbers, then a 5th at t+61 000.
  4. ✅ Test "rate-limited lookups still record their phone digest". Test "guard stores only phone digests": the keys are 64-hex and do not contain the raw phone.
  5. ✅ By code review of `route.ts`: exact bodies, 429 with `Retry-After`, `trackPublicOrders` not reached on a refusal, invalid bodies return 400 before the guard, and no `console.*` in the route, guard or `server.ts`. Not exercised against `next start`.
  6. ✅ By code review of `page.tsx`: the form already renders `error` in `role="alert"`, and the "Мои заказы" list now renders `role="alert"` in place of the empty-state text. The right pane hides «Нет доступных заказов» while the error is shown, and non-429 failures fall back to «Ошибка при загрузке заказов.». Not clicked through in a browser.
  7. ✅ lint, build and test:frontend pass. `tracking-phone.test.ts` and `checkout-rate-limit.test.ts` are unchanged and pass.
- Tests run (in the worktree, after `npm ci`):
  - `npm run test:frontend`: 67 pass, 0 fail.
  - `node --test tests/tracking-guard.test.ts`: 9 pass, 0 fail.
  - `npm run lint`: clean.
  - `npm run build`: success.
  - Backend tests were not run, because no backend change was made.
- Open questions / not done:
  - The 5-hour block is only per instance (Option A, owner accepted).
  - The blocked message has no support contact.
  - The per-minute limiter's own `maxKeys` cap fails closed for new IPs for at most 60 s. This is existing `rate-limit.ts` behaviour and was left unchanged.
  - The `tsconfig.json` change is outside the listed scope but is needed for the sibling `.ts` import. The alternative is inlining the limiter.

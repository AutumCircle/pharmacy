# 006-tracking-scrape-block: Tracking lookup limit and 5-hour block for number scraping

## Owner request (verbatim)

<004, лимит на отслеживание> нужно сделать пять запросов за минуту но если человек смотрит пять разных номеров в течение одной минуты значит это сто процентов он парсит информацию значит нужно отключить ему парсинг например пять часов нужно вот это добавить эту функцию

## Goal
Order tracking (`/tracking` -> `POST /api/tracking`) lets anyone look up orders by phone number, with no limit. That allows enumerating customers' orders. This job adds two rules, keyed by client IP:
- (a) at most 5 tracking lookups per minute;
- (b) a client that looks up 5 different phone numbers within one minute is treated as a scraper and cannot use tracking for 5 hours.

Repeat lookups of the same number count toward (a) but never toward (b). Ordinary customers, including a family checking a few orders, must keep working. When they hit a limit they get a calm Russian message telling them roughly when to try again. This replaces the owner's earlier decision that tracking stays unlimited (commit 92cb544, the revert of job 004).

### Where the counters and the block live (decision)
- **Option A, recommended for this job:** in memory in the Next.js route, per Vercel instance, built on the existing `src/lib/rate-limit.ts`.
  - It needs no migration, no Lambda deploy, no new dependency and no infrastructure. It ships with the normal Vercel deploy.
  - Weakness: the 5-hour block is per instance. It is lost on cold start and is not shared between warm instances. A blocked scraper that lands on another instance, or arrives after a redeploy or idle scale-down, is not blocked. In practice the block will often last minutes, not 5 hours.
  - It still stops a naive single-IP scraper while that instance stays warm.
  - The spec must state this honestly in the docs. It must not claim a guaranteed 5-hour ban.
- **Option B, follow-up that needs escalation:** a Lambda/RDS-backed store, i.e. a table of `(ip_hash, window, distinct phone hashes, blocked_until)`, following the `staff_accounts.locked_until` pattern.
  - It gives a real, global 5-hour block. It also fulfils API_CONTRACT §7, which asks for "rate limit по IP и hash нормализованного телефона".
  - It needs a **new migration**, a **Lambda deploy**, and Next.js forwarding the client IP to Lambda as a trusted header. That header is trusted only because API Gateway requires the server-only `API_KEY`.
  - Vercel KV/Upstash is the other route, but it is new infrastructure plus a new dependency.
  - Not built in this job. The approver should escalate to the owner if the 5-hour block must be reliable.

The guard module must sit behind a small interface (`check(ip, phoneNormalized, now)` -> decision) so that Option B can replace it later without touching the route or the page.

## Scope
- New `src/lib/tracking-guard.ts`. It is pure and dependency-free apart from `node:crypto`, and has no Next.js or `@/` imports, so `node --test` can import it.
  - Named exported constants:
    - `TRACKING_RATE_LIMIT = 5`
    - `TRACKING_RATE_WINDOW_MS = 60_000`
    - `TRACKING_SCRAPE_DISTINCT_PHONES = 5`
    - `TRACKING_SCRAPE_WINDOW_MS = 60_000`
    - `TRACKING_BLOCK_MS = 5 * 60 * 60 * 1000`
    - `TRACKING_MAX_KEYS = 10_000`
  - The per-minute limit reuses `createFixedWindowLimiter` from `src/lib/rate-limit.ts`.
  - The distinct-phone tracker and block map are new. Phones are stored only as an HMAC-SHA-256 digest. The HMAC key is random per process (`randomBytes` at module load). A plain SHA-256 of a 9-digit space can be brute-forced.
  - Each IP keeps at most `TRACKING_SCRAPE_DISTINCT_PHONES` hashes, with timestamps. They are dropped once older than the window.
  - A factory `createTrackingGuard(options)` makes the module testable with an injected `now`. The route uses a module-level singleton built from the constants.
- `src/app/api/tracking/route.ts`. Order of checks for a **valid** body:
  1. Active block -> 429 `TRACKING_BLOCKED`.
  2. Record the phone hash. If this makes `>= TRACKING_SCRAPE_DISTINCT_PHONES` distinct numbers within `TRACKING_SCRAPE_WINDOW_MS`, start the block and return 429 `TRACKING_BLOCKED` for this request too.
  3. Per-minute limiter -> 429 `RATE_LIMITED`.
  4. Call `trackPublicOrders`.

  Invalid bodies still return 400 and consume nothing. Every 429 carries `Retry-After`, in seconds. Neither 429 calls upstream.
- `src/lib/api-v1/client-reads.ts`: on a non-OK response, the thrown error must expose `status` and the server's `error.code`/`error.message`, for example through a small typed error class. Dedupe and caching stay as they are. Checkout is not affected.
- `src/app/tracking/page.tsx`: show the 429 message. The error must also be visible in the "Мои заказы" view, not only in the search form. Today that view shows nothing on failure and falls through to «У вас пока нет заказов», which is misleading. Non-429 failures keep «Ошибка при загрузке заказов.».
- `package.json`: add the new test file to `test:frontend`.
- `API_CONTRACT.md` §7 and §11: document both rules, the values, the IP key, the hashed phone storage, the per-instance scope (Option A limitations) and the 429 bodies. Replace the line «Tracking … не ограничивается (решение владельца)».
- **Out of scope:**
  - `src/app/api/checkout/route.ts` and checkout behaviour.
  - Changes to the existing exports of `src/lib/rate-limit.ts`. Adding to it is allowed only if it is backward-compatible, and `tests/checkout-rate-limit.test.ts` must pass unchanged.
  - `backend/v1`, `db/migrations`, `backend/local-agent/agent.py`.
  - Admin and staff login limiters.
  - Any deploy.

## Acceptance criteria
1. Guard unit behaviour with injected `now`, same IP:
   - 5 lookups of the **same** number within 60 s are allowed.
   - The 6th is refused with `RATE_LIMITED`, and `retryAfterSeconds` is in 1..60.
   - At `t + 60_000` it is allowed again.
   - No block is ever started by this sequence.
2. Same IP, numbers P1..P5 within 60 s:
   - The lookups for P1..P4 are allowed.
   - The P5 lookup returns `TRACKING_BLOCKED` with `retryAfterSeconds` ≈ 5 h (in `18_000 ± 1`).
   - Any lookup, including P1, is refused with `TRACKING_BLOCKED` until `t + TRACKING_BLOCK_MS`. After that it is allowed.
   - A different IP is unaffected throughout.
3. Distinct numbers spread out so that no 60 s window holds 5 of them do not block. Example: 4 numbers, then a 5th at `t + 61_000`.
4. Lookups refused by the per-minute limit still record their phone hash. A scraper cannot dodge rule (b) by being rate-limited first. The guard holds no raw phone string: a test checks that the stored keys for the IP do not contain the normalized phone.
5. The route returns these exact bodies, each with status 429 and a `Retry-After` header:
   - `{ "error": { "code": "RATE_LIMITED", "message": "Слишком много запросов. Пожалуйста, повторите через минуту." } }`
   - `{ "error": { "code": "TRACKING_BLOCKED", "message": "Поиск заказов временно недоступен. Пожалуйста, попробуйте снова примерно через 5 часов." } }`

   In both cases `trackPublicOrders` is not called. Invalid phone bodies still return 400 and do not touch the guard. Phones and phone hashes are never passed to `console.*`. Check this by code review, or by hand against `next start` with an unreachable upstream.
6. On `/tracking`, after a 429, the user sees the server's Russian message in a `role="alert"` element. This applies both on the search form and in the "Мои заказы" view. «У вас пока нет заказов» is not shown while that error is active. A 500/502 still shows «Ошибка при загрузке заказов.».
7. `npm run lint`, `npm run build` and `npm run test:frontend` pass. `test:frontend` includes the new test. `tests/tracking-phone.test.ts` and `tests/checkout-rate-limit.test.ts` pass unchanged.

## Tests
- Add `tests/tracking-guard.test.ts` (`node --test`, importing `../src/lib/tracking-guard.ts`), covering criteria 1–4:
  - Use an injected `now` only, with no real timers.
  - Assert the exported constant values (5, 60 s, 5, 60 s, 5 h).
  - Cover the `maxKeys` cap: memory stays bounded. When the block map is full, the entry that expires first is evicted rather than refusing all new clients for 5 hours.
- No backend tests: Lambda is unchanged.

## Risks
- **The 5-hour block is not reliable under Option A.** It is per Vercel instance, lost on cold start and redeploy, and not shared between instances. IP rotation bypasses it entirely. A durable block needs Option B, which requires a **new migration in `db/migrations`, a Lambda deploy, and Next.js forwarding the client IP to Lambda**, or Vercel KV/Upstash, which is **new infrastructure plus a new dependency**. Either needs approver escalation to the owner. Neither is part of this job.
- **Shared IPs (false positives).**
  - Mobile carrier NAT in Tajikistan can put many customers behind one IP. If unrelated customers on that IP look up 5 different numbers within a minute, everyone on that IP is blocked from tracking on that instance for up to 5 hours.
  - A family checking several orders can trip the 5-number rule.
  - The message is neutral and does not accuse anyone. The owner should know about this cost.
  - The thresholds are named constants so they can be tuned.
  - Failing open when the block map is full limits how much damage can be done.
- **A blocked user has no path to support.** The message does not include a phone number. The owner may want to add a contact line later.
- **IP source.** `clientAddress` trusts `x-forwarded-for`. That is correct on Vercel but can be spoofed elsewhere. Requests without the header share the `'unknown'` bucket, so one scraper without headers could block all header-less clients. This does not happen on Vercel.
- **Privacy.**
  - The guard keys on IP only and stores phones as HMAC digests with a per-process random key, dropped after 60 s.
  - Raw phones must never be logged or kept.
  - IPs are held in memory only, which is the same as the existing checkout limiter.
- **Contract gap.** API_CONTRACT §7's "по IP и hash телефона" is still only partly met. The phone hash is used only to count distinct numbers per IP. On purpose, there is no per-phone bucket that would let an attacker lock a victim out of tracking their own orders. Record this in the doc.
- **Auto-fetch on load.** The page fetches the saved phone on every visit, and each fetch counts toward the 5 per minute. Repeated reloads can hit the per-minute limit. That is acceptable, and the message says "через минуту".
- **No migration, Lambda change, deploy or `backend/local-agent/agent.py` change** is required for Option A. Windows 7 agent compatibility is unaffected. All new customer-facing copy is Russian.

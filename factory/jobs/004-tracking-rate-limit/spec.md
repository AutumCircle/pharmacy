# 004-tracking-rate-limit: Per-client rate limit on order tracking lookups

## Owner request (verbatim)

Rate-limit order tracking lookups: `/api/tracking` answers HTTP 429 with a Russian message after too many phone lookups from one client, so phone numbers can't be enumerated

## Goal
Anyone can call `POST /api/tracking` (`src/app/api/tracking/route.ts`) as often as they like.
Each valid 9-digit phone goes straight to Lambda `track_orders`, and the response contains order
contents. So a script can loop over phone numbers and find out which ones have orders, and
what those orders contain. `API_CONTRACT.md` §7 and `PRODUCT.md` already say that phone-only
tracking is approved only together with rate limiting, but no limit exists today. After this
job, one client (one client IP) gets a limited number of tracking lookups per time window.
Further requests get HTTP 429 with a Russian message, and the tracking page shows that message
instead of the generic «Ошибка при загрузке заказов.». Normal customers are not affected: they
check one or two numbers, a few times.

### Where the counter lives (design decision)
**Chosen for this job: an in-memory counter in each Vercel instance.** It is a fixed window,
keyed by client IP, and lives in the Next.js route handler. This is the same pattern as
`src/app/api/admin/login/route.ts` and `src/app/api/staff/login/route.ts`.
- Pros: no migration, no new infrastructure, no new dependency, no Lambda deploy. It can ship
  with a normal Vercel deploy from `main`. Blocked requests never reach API Gateway, Lambda or
  RDS.
- Cons: Vercel serverless instances do not share memory. The real ceiling is therefore
  `limit × number of warm instances`, and a cold start resets the counter. This makes
  enumeration much slower and noisier for a single client, but it is **not** a hard global
  guarantee.
- Rejected for now:
  - (a) A Lambda/RDS-backed counter, for example a `tracking_rate_limits` table with an atomic
    `INSERT ... ON CONFLICT DO UPDATE`. Next.js would have to forward the client IP in a
    header to Lambda. This needs a new migration and a Lambda deploy.
  - (b) Vercel KV/Upstash Redis. This needs new infrastructure and a new npm dependency.
  - (c) API Gateway usage-plan throttling. It only sees Vercel's egress IPs, not end users, so
    it cannot limit per client.

  All three are listed under Risks as the follow-up if a hard global limit is needed.

## Scope
- New pure module `src/lib/rate-limit.ts`. It has no Next.js imports and no `@/` aliases, so
  `node --test` can import it. It exports:
  - `createFixedWindowLimiter({ limit, windowMs, maxKeys })`. It returns an object with
    `consume(key: string, now: number): { allowed: boolean; retryAfterSeconds: number }`.
    Behaviour:
    - It prunes expired entries.
    - When the map holds `maxKeys` entries and the key is new, it refuses (`allowed: false`).
      This bounds memory.
    - It counts only when allowed.
  - `clientAddress(headers: Headers): string`. It returns the first `x-forwarded-for` entry,
    then `x-real-ip`, else the shared literal bucket `'unknown'`.
- `src/app/api/tracking/route.ts`:
  - It creates one module-level limiter. Suggested values: `limit` 10, `windowMs` 10 minutes,
    `maxKeys` 10_000. Name them as constants. The builder may tune them but must document the
    values in `API_CONTRACT.md`.
  - The limiter is consulted **after** body/phone validation passes and **before**
    `trackPublicOrders`. Every valid lookup counts, whether or not orders exist.
  - When refused, it returns status 429, header `Retry-After: <seconds>`, and body
    `{ "error": { "code": "RATE_LIMITED", "message": "Слишком много запросов. Повторите через несколько минут." } }`.
  - It does not call Lambda when refused.
  - It does not log the raw phone.
- `src/lib/api-v1/client-reads.ts`: on a non-OK response, the thrown error carries the HTTP
  status and the server `error.message` when present, for example a small exported
  `PublicReadError` class. Successful-path behaviour and the dedupe cache stay unchanged.
- `src/app/tracking/page.tsx`: on a 429, show the server's Russian message in the existing error
  `role="alert"` block. Other failures keep «Ошибка при загрузке заказов.».
- `API_CONTRACT.md` §7: describe the implemented limit. Say that it is per IP, in memory per
  Vercel instance, give the window and limit, the 429 body and `Retry-After`, and state that the
  per-phone-hash and Lambda-side limit is not yet implemented.
- `package.json`: add the new test file to `test:frontend`.
- Out of scope:
  - `backend/v1` (no Lambda change);
  - `db/migrations`;
  - API Gateway or Vercel configuration;
  - new npm dependencies;
  - refactoring the admin/staff login limiters onto the new helper;
  - a per-phone-hash bucket (see Risks);
  - `parseTrackingPhone` behaviour;
  - `backend/local-agent/agent.py`.

## Acceptance criteria
1. `createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 })`:
   - Three `consume('a', t)` calls are allowed and the fourth is refused, with
     `retryAfterSeconds` > 0 and ≤ 60.
   - `consume('b', t)` is still allowed.
   - At `t + 60_000` key `'a'` is allowed again.
2. With `maxKeys: 2`, after keys `'a'` and `'b'` are active, a new key `'c'` is refused. Once
   the window has expired, `'c'` is allowed (expired entries were pruned).
3. `clientAddress` gives these results:
   - `x-forwarded-for: "1.2.3.4, 10.0.0.1"` → `'1.2.3.4'`
   - only `x-real-ip: "5.6.7.8"` → `'5.6.7.8'`
   - no headers → `'unknown'`
4. Route behaviour, checked manually against `npm run dev` with a stubbed or unreachable
   upstream, or by code review:
   - From one client, the first `limit` valid lookups reach `trackPublicOrders`. The next one
     returns status 429 with `Retry-After` and the exact `RATE_LIMITED` Russian body above,
     without an upstream call.
   - Invalid phone bodies still return 400 and do not consume quota.
5. On `/tracking`, after the limit is hit, the alert shows «Слишком много запросов. Повторите
   через несколько минут.» and not «Ошибка при загрузке заказов.». A 500/502 still shows
   «Ошибка при загрузке заказов.».
6. `API_CONTRACT.md` §7 documents the limit values, the in-memory per-instance scope and the
   429 response.
7. `npm run lint`, `npm run build` and `npm run test:frontend` pass, and `test:frontend` includes
   the new test file. The existing `tests/tracking-phone.test.ts` still passes unchanged.

## Tests
- Add `tests/tracking-rate-limit.test.ts` (`node --test`, importing `../src/lib/rate-limit.ts`)
  covering criteria 1–3:
  - The limit boundary, with an injected `now`. No real timers or `Date.now()` dependence.
  - Independent keys.
  - Window reset.
  - `retryAfterSeconds` range.
  - The `maxKeys` cap and pruning.
  - `clientAddress` header precedence and the `'unknown'` fallback (use the global `Headers`).
- No backend tests: Lambda is unchanged.

## Risks
- **Not a global limit (main trade-off).** The counters are per Vercel instance and are lost on
  cold start. A determined attacker who hits many warm instances, or rotates IPs, still gets
  through faster than `limit` per window. A hard limit needs one of:
  - a Lambda/RDS-backed counter, which needs a **new migration** in `db/migrations`, a
    **Lambda deploy**, and Next.js forwarding the client IP to Lambda as a trusted header (this
    is safe only because API Gateway requires the server-only `API_KEY`);
  - Vercel KV/Upstash, which is **new infrastructure plus a new dependency**.

  Both need approver escalation and are deliberately left out of this job.
- **Contract gap.** `API_CONTRACT.md` asks for limits "by IP and hash of the normalized phone"
  and, implicitly, in Lambda. This job delivers only the per-IP Next.js part. A per-phone bucket
  was left out on purpose: anyone could hammer a victim's number and lock that customer out of
  their own tracking. Record the gap in the doc and do not silently claim full compliance.
- **IP source.** On Vercel, `x-forwarded-for` is set by the platform edge and is trustworthy
  there. Elsewhere, for example in local dev or behind another proxy, it can be spoofed or
  missing. Requests without an IP share one `'unknown'` bucket, so they fail closed. Customers
  behind carrier NAT share one IP; `limit` 10 per 10 minutes is meant to leave room for that.
- **Memory cap behaviour.** When 10_000 distinct active IPs exist on one instance, new clients
  are refused until entries expire. This matches the staff-login limiter and keeps memory
  bounded.
- **Russian copy.** The 429 message must be Russian and must be shown verbatim on `/tracking`.
- **Privacy.** Do not log or key the in-memory limiter by raw phone. The key is the IP only.
- **No deployment, migration, Lambda change or `backend/local-agent/agent.py` change is
  required.** Windows 7 agent compatibility is unaffected. Shipping is the normal Vercel deploy
  from `main` after approval.

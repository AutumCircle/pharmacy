# 005-checkout-rate-limit: Per-client rate limit on checkout order creation

## Owner request (verbatim)

Rate-limit `/api/checkout` per client so a script can't flood the pharmacy with fake orders; legitimate customers retrying once or twice must still succeed

## Goal
Today anyone can call `POST /api/checkout` (`src/app/api/checkout/route.ts`) without limit.
Each request with a valid shape goes to Lambda `createPublicOrder` with a fresh
`Idempotency-Key`. Each one becomes a real order and sends three Telegram messages (owner,
pharmacy, courier). A script can flood the pharmacy with fake orders. After this job, one
client (one client IP) gets a small number of order attempts per time window. Further attempts
get HTTP 429 with a Russian message. The cart page shows a calm Russian message, and the cart,
the form data and the pending idempotency key stay in place, so the customer can simply press
the button again later. A normal customer places one order and retries once or twice. That
stays well inside the limit.

**This job limits `/api/checkout` only.** Job 004 (per-IP limit on `/api/tracking`) was
reverted by the owner in commit 92cb544: "tracking lookups must stay unlimited for every client
and IP". `/api/tracking` and every other route must stay unlimited by this job.

### Where the counter lives (design decision)
**Chosen design: an in-memory fixed-window counter in each Vercel instance.** It is keyed by
client IP and lives in the Next.js checkout route handler. It reuses the design of job 004's
limiter (`git show 808d239 -- src/lib/rate-limit.ts`) and follows the existing pattern in
`src/app/api/admin/login/route.ts`.
- Pros:
  - No migration, no new infrastructure, no new dependency, no Lambda deploy.
  - It ships with a normal Vercel deploy from `main`.
  - Blocked requests never reach API Gateway, Lambda, RDS or Telegram.
- Cons:
  - Vercel serverless instances do not share memory, so the real ceiling is
    `limit × warm instances`.
  - A cold start resets the counter.
  - It slows down and contains a single-IP flood, but it is **not** a hard global
    guarantee.
- Rejected for now (each is listed under Risks as a follow-up):
  - (a) A Lambda/RDS counter. This means a table with an atomic upsert inside `create_order`,
    with Next.js forwarding the client IP. It needs a migration and a Lambda deploy.
  - (b) Vercel KV/Upstash. This needs new infrastructure and a new npm dependency.
  - (c) API Gateway throttling. It only sees Vercel egress IPs, not end users.

## Scope
- Re-add the pure module `src/lib/rate-limit.ts`, with no Next.js imports and no `@/` aliases.
  It has the same API as job 004:
  - `createFixedWindowLimiter({ limit, windowMs, maxKeys })` returns `consume(key, now)`, which
    returns `{ allowed, retryAfterSeconds }`. Expired entries are pruned. A new key is refused
    when `maxKeys` is reached. The counter increases only when the request is allowed.
  - `clientAddress(headers)` returns the first `x-forwarded-for` entry, then `x-real-ip`, and
    otherwise `'unknown'`.
- In `src/app/api/checkout/route.ts`:
  - Create one module-level limiter with named constants. Suggested values: `limit` 5,
    `windowMs` 10 minutes, `maxKeys` 10_000. The builder may tune them but must keep `limit`
    ≥ 3, so that one order plus two retries always passes. The values must be documented.
  - Consult the limiter **after** the `Idempotency-Key` check and the `isCreateOrderRequest`
    check pass, and **before** reading cookies or calling `createPublicOrder`.
  - When the request is refused, return:
    - status 429;
    - header `Retry-After: <seconds>`;
    - body `{ "error": { "code": "RATE_LIMITED", "message": "Слишком много попыток оформить заказ. Подождите несколько минут и попробуйте снова." } }`.

    Do not call Lambda or the notifier, and do not log the phone, the name or the address.
- In `src/app/cart/page.tsx`:
  - Add `RATE_LIMITED` to the existing `messages` map with this calm copy: «Слишком много
    попыток оформить заказ. Подождите несколько минут и попробуйте снова — корзина и данные
    сохранены.»
  - The 429 path must stay in `phase === 'checkout'`. It must not call `clearCart()`, reset
    `formData` or remove `sessionStorage['vatan_pending_order_v1']`. The existing non-OK branch
    already behaves this way; keep it so.
- `API_CONTRACT.md`:
  - In §11 and next to the create-order algorithm, document the checkout limit: per IP, in
    memory per Vercel instance, the window and limit values, the 429 body and `Retry-After`.
  - State that the Lambda-side and phone-hash limits for create order are not implemented yet.
    Do not claim that tracking is limited.
- `package.json`: add `tests/checkout-rate-limit.test.ts` to `test:frontend`.
- Out of scope:
  - `src/app/api/tracking/route.ts`, `src/app/tracking/page.tsx` and
    `src/lib/api-v1/client-reads.ts`. Do not re-apply any part of job 004 except the pure
    limiter module.
  - Every route other than `/api/checkout`.
  - Refactoring the admin/staff login limiters.
  - `backend/v1`, `db/migrations`, Vercel/API Gateway config and new npm dependencies.
  - `backend/local-agent/agent.py`.

## Acceptance criteria
1. Limiter unit behaviour with `createFixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 })`:
   - Three `consume('a', t)` calls are allowed.
   - The fourth call is refused, with `0 < retryAfterSeconds ≤ 60`.
   - `'b'` is still allowed.
   - `'a'` is allowed again at `t + 60_000`.
2. With `maxKeys: 2`, a third new key is refused while `'a'` and `'b'` are active. After their
   window expires, it is allowed.
3. `clientAddress` results:
   - `x-forwarded-for: "1.2.3.4, 10.0.0.1"` gives `'1.2.3.4'`.
   - Only `x-real-ip: "5.6.7.8"` gives `'5.6.7.8'`.
   - No headers gives `'unknown'`.
4. The checkout route, checked manually against `next start`/`npm run dev` with a stubbed or
   unreachable upstream, or by code review:
   - From one client, the first `limit` valid-shaped requests reach `createPublicOrder`. This
     includes 3 requests that repeat the same `Idempotency-Key`.
   - The next request returns 429 with `Retry-After` and the exact `RATE_LIMITED` body above.
     It makes no upstream call and sends no notification.
   - A missing `Idempotency-Key` or an invalid body still returns 400 and uses no quota.
5. In `/cart`, a forced 429 (limit reached, or a temporarily lowered `limit` in dev) gives this
   result:
   - The `role="alert"` block shows the `RATE_LIMITED` copy from Scope.
   - The page stays on the checkout form.
   - Cart items, name, phone, address and comment are unchanged.
   - `vatan_pending_order_v1` is still in sessionStorage.
   - After the window expires, pressing submit again creates the order with the same
     idempotency key.
6. `/api/tracking` is not limited. `git diff main -- src/app/api/tracking src/app/tracking
   src/lib/api-v1/client-reads.ts` is empty, and `src/lib/rate-limit.ts` is imported only by
   `src/app/api/checkout/route.ts` and the new test (`rg "rate-limit" src tests`).
7. `API_CONTRACT.md` documents the checkout limit values, the per-instance scope, the 429
   response and the remaining gap.
8. `npm run lint`, `npm run build` and `npm run test:frontend` pass, and `test:frontend` includes
   the new test file.

## Tests
- Add `tests/checkout-rate-limit.test.ts` (`node --test`, importing `../src/lib/rate-limit.ts`)
  for criteria 1–3:
  - Use an injected `now` only; do not depend on `Date.now()` or timers.
  - Cover the limit boundary, independent keys, the window reset and the `retryAfterSeconds`
    range.
  - Cover the `maxKeys` cap and pruning.
  - Cover `clientAddress` header precedence and the fallback, using the global `Headers`.
- Criteria 4–6 are checked manually or by code review/diff. The builder must record in
  `build.md` exactly what was run.
- No backend tests, because Lambda is unchanged.

## Risks
- **Not a global limit.**
  - The counters are per Vercel instance and are lost on cold start. An attacker who uses
    many warm instances or rotates IPs still gets more than `limit` orders per window.
  - A hard limit needs either:
    - a Lambda/RDS counter, which means a **new migration**, a **Lambda deploy**, and a
      trusted client-IP header from Next.js (safe only because API Gateway requires the
      server-only `API_KEY`); or
    - Vercel KV/Upstash, which is **new infrastructure plus a new dependency**.
  - Both need approver escalation and are out of this job.
- **Contract gap.** `API_CONTRACT.md` asks for create-order limits in Lambda, by IP and phone
  hash. This job adds only the per-IP Next.js part. A per-phone bucket would let anyone lock
  a victim out of ordering. Record the gap and do not claim full compliance.
- **Shared IPs and NAT.** Mobile carrier NAT can put many customers behind one IP. The limit
  must leave room for that and for honest retries, so `limit` must stay ≥ 3. Requests with no
  IP header share the `'unknown'` bucket, which fails closed. On Vercel, `x-forwarded-for`
  is set by the platform; elsewhere it can be spoofed.
- **Idempotent retries count.** A retry with the same `Idempotency-Key` uses quota like any
  other request. Not counting retries would need per-key state and is left out. The chosen
  limit must cover one order plus two retries plus one correction (for example, after
  `ORDER_ITEMS_UNAVAILABLE`).
- **No lost orders or data.** A 429 must never clear the cart, the form or the pending
  idempotency key. If it did, a later retry could create a duplicate order or the customer
  would lose their input.
- **Owner constraint.** Any limiting of `/api/tracking` or other routes is a regression of the
  owner's explicit decision in 92cb544. Reviewers must reject it.
- **Russian copy.** Both the server message and the cart message are Russian and calm, and they
  are shown verbatim.
- **Privacy.** The limiter key is the IP only. Never log or key by phone, name or address.
- No deploy, migration, Lambda change or `backend/local-agent/agent.py` change is required.
  Windows 7 agent compatibility is unaffected. The change ships with the normal Vercel deploy
  from `main` after approval.

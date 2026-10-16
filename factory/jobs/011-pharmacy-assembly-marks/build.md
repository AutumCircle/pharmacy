# Build notes — 011-pharmacy-assembly-marks

## Round 1
- Commits:
  - 1f6e300 feat(staff): pharmacy assembly marks in Lambda + migration 0025 (job 011)
  - 7d582e5 feat(staff): «Начать сборку» / «Собран» UI and courier marks (job 011)
- Changed:
  - `db/migrations/0025_order_pharmacy_assembly.sql` (new, not run)
  - `backend/v1/admin_api/lambda_function.py` (`validate_assembly_request`, `mark_pharmacy_assembly`,
    route `POST /v1/staff/orders/{id}/assembly`, pharmacy queue `assembly_state`/`assembly_available`,
    `_COURIER_ORDER_SELECT` assembly LATERAL, `_courier_order_row` `assembly`/`assembly_complete`)
  - `backend/tests/test_pharmacy_assembly.py` (new), `backend/tests/test_staff_accounts.py`,
    `backend/tests/test_courier_orders.py` (extended; existing arg tuple 5→6 pharmacy params and
    LATERAL count 3→4 updated)
  - `src/app/api/staff/orders/[order_id]/assembly/route.ts` (new), `src/lib/pharmacy-assembly.ts` (new),
    `src/app/staff/orders/PharmacyAssemblyButtons.tsx` (new), `src/app/staff/orders/PharmacyOrderCard.tsx`,
    `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx`, `src/app/staff/orders/CourierOrderList.tsx`,
    `src/app/staff/staff.css`, `src/lib/api-v1/staff-server.ts`, `src/lib/api-v1/staff-types.ts`,
    `src/lib/pharmacy-order.ts`
  - `tests/pharmacy-assembly.test.ts` (new, added to `test:frontend`), `tests/pharmacy-order.test.ts`
  - `package.json`, `API_CONTRACT.md` (§8.1.2, §8.1.2a, rollout line)
- Acceptance criteria:
  1. Migration ✅ — only new migration is 0025; `BEGIN/COMMIT`, `CREATE TABLE IF NOT EXISTS` inside a DO
     block that reads `orders.id` type from `pg_attribute` (like 0024); named inline CHECKs, FK
     `ON DELETE CASCADE`, PK `(order_id, pharmacy_id)`; no DROP/UPDATE/DELETE/ALTER. Reviewed by reading.
  2. Endpoint validation/authorization ✅ — `test_pharmacy_assembly.py`: courier → 403 (handler test),
     bad bodies incl. `pharmacy_id` → 400 before DB, missing/deleted/non-website/no-assigned-items → 404,
     status ≠ confirmed → 409 ORDER_STATUS_CONFLICT «Сборка доступна после согласования заказа», all
     unavailable → 409 «Нечего собирать» (code `NOTHING_TO_ASSEMBLE`), skip/backward → 409
     ASSEMBLY_STATE_CONFLICT; order row `FOR UPDATE`; every error path asserted SELECT-only.
  3. Writes/idempotency/audit ✅ — upsert SQL + args asserted for none→assembling→assembled
     (`assembled_at` via `CASE WHEN … THEN now()`), repeat = 3 SELECTs, no audit, same projection;
     audit `staff:N` / `pharmacy.order.assembly_marked` / `{pharmacy_id, from_state, to_state}`, no PII;
     no `UPDATE orders` / `order_status_history`; pharmacy id only from session.
  4. Pharmacy queue ✅ — `test_staff_accounts.py`: `assembly_state`/`assembly_available` cases
     (true only when confirmed with an assemblable item), survive an all-off `pharmacy_web` policy, old
     rows default to null/false; unknown query keys still 400 (existing test); 010 fields unchanged.
  5. Courier projection ✅ — `test_courier_orders.py`: single pharmacy, routed 1→2 (`[1 assembled, 2 waiting]`,
     complete false), SQL excludes pharmacies whose current answer is unavailable, courier-created → `[]`,
     complete only while confirmed; LATERAL count 4, one query for the list.
  6. UI ✅ — pure helpers unit-tested (`tests/pharmacy-assembly.test.ts`, `tests/pharmacy-order.test.ts`);
     components wired: pharmacy card shows chip + «Начать сборку» → «Собран» → chip «Собран», 409 shows the
     Lambda message and `router.refresh()`; no `assembly_available` → no buttons. Courier detail block
     «Сборка в аптеках», list line «Сборка: …» for confirmed, step-5 and «Выехал» warning while confirmed
     and incomplete, «Выехал» stays enabled; old Lambda → no marks/no warning. `checklistProgress` untouched.
     Not visually checked in a browser (no live API in the worktree).
  7. Gates ✅ — see below.
- Tests run (from the worktree):
  - `npm ci` → ok (node_modules not committed)
  - `python3 -m unittest discover -s backend/tests -t .` → 335 tests, only the 2 known main failures
    (`test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`)
  - `npm run test:frontend` → 110/110 pass
  - `npm run lint` → clean
  - `npm run build` → success (exit 0; the usual sitemap "API v1 server configuration is incomplete" log
    because no env is set; `/api/staff/orders/[order_id]/assembly` listed)
- Decisions / notes for review:
  - «Нечего собирать» uses code `NOTHING_TO_ASSEMBLE` (spec gave only the message).
  - `assembly_complete` is computed in Python from `assembly`; with no assembly pharmacies it is vacuously
    true while confirmed (so courier-created orders never show the warning).
  - Courier `started_at`/`assembled_at` are passed through as Postgres JSON timestamps (same as 010
    `answered_at`); the POST response uses `order_time_iso`.
  - Pharmacy card status chip for `confirmed` relabelled «Собирается» → «Согласован» so it does not
    contradict the new «Ждёт сборки» mark. Courier status labels unchanged.
  - `.c-action-bar` now `flex-wrap: wrap` so the warning sits above the buttons at 360 px.
- Open questions / not done:
  - ESCALATE (per spec Risks): apply 0025 to live RDS, then deploy `admin-api-v1.zip`, then Vercel. Not done.
  - No undo of a mark; admin edits after confirmed do not reset «Собран» (may be stale); no notifications (job 012).
  - `backend/local-agent/agent.py` untouched.

## Round 2
- Commits:
  - 9922f27 feat(staff): rework 1 — assembly while «Новый», per-item «Собрано», «Согласовано» gate (job 011)
  - f765d5e feat(staff): rework 1 UI — assembly before «Согласовано», «Ватан 2» per item, colours (job 011)
- Merge of `main`: not needed (branch base 2eebac5 = current `main` HEAD).
- Changed:
  - `db/migrations/0025_order_pharmacy_assembly.sql`: still additive and still not applied. It now also
    creates `order_item_assembly (order_item_id, pharmacy_id, collected_at, collected_by)` with a PK and
    `ON DELETE CASCADE`.
  - `backend/v1/admin_api/lambda_function.py`:
    - `ASSEMBLY_ORDER_STATUSES = (pending, confirmed)`.
    - `mark_pharmacy_assembly` is allowed while pending. «Сборка сделана» on a pending order writes
      `available` for this pharmacy's unanswered items.
    - New `collect_pharmacy_order_item` behind `POST /v1/staff/orders/{id}/assembly/items`, plus
      `_sync_item_assembly` (one upsert, forward only).
    - `validate_pharmacy_answers` accepts `base_unit_price` together with `available` (checked with
      `validate_unit_price`). `answer_pharmacy_order_items` accepts it from pharmacy 2 only and calls
      `_reprice_items_from_base`: new base → `vatan_selling_unit_price(base)` → line → order totals, like the
      admin base-price edit, with audit `pharmacy.order.item_price_changed`.
    - In `update_courier_order_status`, pending → confirmed on a website order calls
      `_require_assembly_complete`, which returns 409 `ASSEMBLY_NOT_COMPLETE`.
    - The pharmacy queue adds `routed_here` / `collected` per item and a `routed_away` list.
      `assembly_complete` no longer depends on `confirmed`.
  - Backend tests: `backend/tests/test_pharmacy_assembly_items.py` (new); `test_pharmacy_assembly.py`,
    `test_staff_accounts.py`, `test_courier_orders.py`, `test_pharmacy_answers.py` updated. In the 010
    "bad shapes" list I removed the `base_unit_price` entry, because it is now valid for pharmacy 2; a new
    test checks that pharmacy 1 gets 403.
  - Frontend:
    - New: `src/app/staff/orders/PharmacyRoutedItems.tsx`, `src/app/api/staff/orders/[order_id]/assembly/items/route.ts`.
    - Updated: `PharmacyOrderCard.tsx`, `CourierOrderDetail.tsx`, `CourierOrderList.tsx`, `staff.css` (new
      tokens `--c-orange` and `--c-orange-soft`), `src/lib/pharmacy-answers.ts`, `src/lib/pharmacy-assembly.ts`,
      `src/lib/pharmacy-order.ts`, `src/lib/api-v1/staff-types.ts`, `src/lib/api-v1/staff-server.ts`.
    - Tests: `tests/pharmacy-answers.test.ts`, `tests/pharmacy-assembly.test.ts`, `tests/pharmacy-order.test.ts`.
  - `API_CONTRACT.md` §8.1.2 / §8.1.2a: rewritten for the new flow.
- Interpretation of rework-1 (the orchestrator's reading of the voice note; the owner may correct it):
  1. While the order is `pending`, «Ватан 1» presses «Начать сборку» right away. Missing items are marked
     «Нет в наличии» (the 010 answer) and go to «Ватан 2» automatically. «Ватан 1» assembles the rest,
     then presses «Сборка сделана» for its part.
  2. «Ватан 2», for each routed item: «В наличии», keep or change the pharmacy (base) price and save, then
     «Собрано». Its part is done when every item is «Собрано» or unavailable. The price change is an input
     only. Lambda recomputes the client price, line and order totals from the stored pricing rules, audits
     the change and never trusts client totals. The price is validated (positive, bounded).
  3. Colours: an item missing in both pharmacies is RED «Нет в наличии в обеих аптеках». An item moved to
     «Ватан 2» and available there is ORANGE «В аптеке 2». Both use staff.css tokens.
  4. The courier's «Согласовано» (pending → confirmed) is BLOCKED in the UI and in Lambda (409 with a
     Russian message) until every pharmacy with collectable items has finished. Orders with nothing to
     assemble are not blocked. After that the courier calls the client and confirms. There are no new
     order statuses, and customer statuses are unchanged.
  5. Answers and assembly are allowed while `pending`; round 1 required `confirmed`, which is changed. 0025
     is not applied anywhere, so it may change, but it stays additive. The step-5 warning is kept consistent
     now that assembly happens before step 4.
  6. «Уведомление приходит и аптеке» means notifications, which belong to job 012 and are out of scope.
- Builder decisions on top of that reading (please check):
  - «Сборка сделана» on a pending order writes `available` for this pharmacy's unanswered items. Step 3
    and «Подтверждённая сумма» then complete without a separate «В наличии» tap. The audit row lists these
    items under `answered_available`. Items that already have an answer, including `price_differs`, are
    left as they are.
  - Per-item «Собрано» requires the pharmacy's answer to be `available`; otherwise it returns 409
    `ITEM_NOT_AVAILABLE`. The endpoint works for both pharmacies, but the UI shows it only for items routed
    to «Ватан 2».
  - «Ватан 2»'s part mark is derived from its items. The derived row gets no audit of its own; the item
    actions are audited.
  - When «Ватан 2» is the order's own pharmacy, it uses «Начать сборку» / «Сборка сделана» like «Ватан 1».
  - Only pharmacy 2 can change a price (pharmacy 1 gets 403), and only together with `available`. The
    range is 0.01–999 999.99 with at most 2 decimals (the existing `validate_unit_price`).
  - The new client price is `vatan_selling_unit_price(new base)`, the checkout markup rule. Totals are
    recomputed as in `update_order_item_price`: `items_subtotal = order_total = total_price = SUM(line_total)`.
  - Unlike the admin edit, a pharmacy price change does not void the pharmacy's own answer, because that
    pharmacy is the one answering.
  - The confirm gate covers only the courier's `pending → confirmed` on website orders. Admin status
    changes are not gated.
  - After deploy, the courier cannot confirm existing `pending` website orders until the pharmacies mark
    them. The owner should know this before deploy.
  - `confirmed` orders still accept marks, for orders confirmed before this change. For those orders the
    step-5 / «Выехал» note stays and does not block.
  - `assembly_complete` = the order is not cancelled and every assembly pharmacy is `assembled`. It is true
    when there are no assembly pharmacies.
  - «Ватан 1»'s card lists the items it sent away with «Ватан 2»'s result: orange, red, or
    «Ждём ответ Ватан 2». On the courier card both the item row and its label are tinted red or orange.
  - Two courier labels from 010 changed: «Ватан 1: нет → Ватан 2: в наличии» is now «В аптеке 2», and
    «… нет в наличии · нет ни в одной аптеке» is now «Нет в наличии в обеих аптеках».
- Acceptance criteria (round 1 ACs, adjusted for rework-1):
  1. Migration ✅ — still the only new migration. `BEGIN/COMMIT`, `CREATE TABLE IF NOT EXISTS` inside DO
     blocks that read the id type from the catalogue, no DROP/UPDATE/DELETE/ALTER.
  2. Endpoint validation and authorization ✅ — the status rule is now pending or confirmed, and the tests
     are updated. The collect endpoint is tested for 400/403/404/409, courier 403 and the pharmacy id taken
     from the session.
  3. Writes, idempotency, audit ✅ — tests assert the part upsert, the auto-answer on a pending «Сборка
     сделана», the collect insert, the sync SQL and the reprice SQL and args. Repeats write nothing, audit
     rows carry no PII, and the pharmacy endpoints never touch `order_status_history`.
  4. Pharmacy queue ✅ — `assembly_available` is true for pending orders. `routed_here` / `collected` are
     present. `routed_away` follows the `items` and `quantity` policy.
  5. Courier projection and gate ✅ — `assembly_complete` no longer depends on the status. Pending →
     confirmed returns 409 until every part is assembled, passes when all are assembled or there is nothing
     to assemble, and courier-created orders are not gated.
  6. UI ✅ — helpers are unit-tested; not checked in a browser. Covered: part buttons, «Ватан 2» per-item
     controls, the colours, the disabled courier confirm with its reason, and degrading on an old Lambda.
  7. Gates ✅ — see below.
- Tests run (from the worktree):
  - `python3 -m unittest discover -s backend/tests -t .` → 354 tests; only the 2 known main failures
  - `npm run test:frontend` → 116/116 pass
  - `npm run lint` → clean
  - `npm run build` → success (exit 0). It printed the usual sitemap env log. Both routes are listed:
    `/api/staff/orders/[order_id]/assembly` and `/assembly/items`.
- Review findings addressed: all four round-1 reviews were PASS. This round addresses `rework-1.md`
  (items 1–6 above).
- Open questions / not done:
  - Notifications to the pharmacy on a new order, on routing and on marks belong to job 012 (out of scope).
  - ESCALATE as before: apply 0025, then deploy `admin-api-v1.zip`, then deploy Vercel. New this round:
    after deploy the courier cannot confirm pending website orders until the pharmacies mark assembly.
  - Marks and «Собрано» cannot be undone, and admin edits do not reset them.
  - The pharmacy reprice path has no order-total overflow guard; prices are capped at 999 999.99.
  - `backend/local-agent/agent.py` untouched. No migration run, no push, no deploy.

# Build log: 010-pharmacist-actions-routing

## Round 1
- Commits (branch `factory/010-pharmacist-actions-routing`):
  - b6e962c feat(lambda): pharmacist per-item answers with automatic routing to Vatan 2
  - 04d6410 feat(staff): pharmacist answer form, courier answer labels and confirmed amount
  - 0df81c0 docs(api): pharmacy answers endpoint, per-item routing and derived step 3 (job 010)
- Changed:
  - `db/migrations/0024_order_item_pharmacy_answers.sql` (new, written, NOT run)
  - `backend/v1/admin_api/lambda_function.py`
  - `backend/tests/test_pharmacy_answers.py` (new), `test_staff_accounts.py`, `test_courier_orders.py`, `test_admin_order_item_adjustments.py`
  - `src/lib/pharmacy-answers.ts` (new), `src/lib/pharmacy-order.ts`, `src/lib/courier-checklist.ts`, `src/lib/api-v1/staff-types.ts`, `src/lib/api-v1/staff-server.ts`
  - `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts` (new), `.../checklist/route.ts` (step 3 → «Этот шаг отмечается ответом аптеки»)
  - `src/app/staff/orders/PharmacyAnswerForm.tsx` (new), `PharmacyOrderCard.tsx`, `page.tsx`, `CourierOrderList.tsx`, `[order_id]/CourierOrderDetail.tsx`, `src/app/staff/staff.css`
  - `tests/pharmacy-answers.test.ts` (new, added to `test:frontend`), `tests/courier-checklist.test.ts`, `tests/pharmacy-order.test.ts`, `package.json`
  - `API_CONTRACT.md` §8.1.2 / §8.1.2a. `docs/PROJECT_CONTEXT.md` has no migration list, so it is unchanged.
- Acceptance criteria:
  1. ✅ Migration: 0024 is the only new migration (`git diff main --stat -- db/migrations`). It has `BEGIN/COMMIT`, `ADD COLUMN IF NOT EXISTS`, a CHECK guarded by `pg_constraint`, `CREATE TABLE IF NOT EXISTS` (run via `EXECUTE format` so `order_item_id` gets exactly the catalogue type of `order_items.id`), and a partial `CREATE INDEX IF NOT EXISTS`. It has no DROP, UPDATE or DELETE of data. It was reviewed by reading only, not run.
  2. ✅ Validation and authorization are covered in `test_pharmacy_answers.py`: courier → 403; extra or price keys, `pharmacy_id` in the body, 0 or 51 entries, duplicates and problem rules → 400 before the DB; another pharmacy's item → 403; item not in the order → 404 `ORDER_ITEM_NOT_FOUND`; missing, non-website or no-own-item order → 404 `ORDER_NOT_FOUND`; not pending → 409. The order is read `FOR UPDATE` and items `FOR UPDATE OF oi`. Every error path is asserted to issue SELECTs only.
  3. ✅ Routing: the UPDATE SQL and args are asserted (`SET fulfillment_pharmacy_id = 2, pharmacy_assigned_at = now()`, `(order_id, [81])`). `price_differs` from pharmacy 1, `unavailable` from pharmacy 2, and orders originally at pharmacy 2 do not route (tests). The queue tests cover pharmacy 2 `awaiting_response` and `routed_away_count`.
  4. ✅ Idempotency and audit: a repeated request issues 2 SELECTs, no writes and no audit, and returns an identical projection. A routed item re-sent unchanged by pharmacy 1 is a no-op, not a 403. The exact audit shape is asserted, and the audit contains no client-data or problem text. No `UPDATE orders` or `order_status_history`.
  5. ✅ Pharmacy queue: SQL uses `COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)` for the item filter, the EXISTS filter and routed-away. Per-item `order_item_id`/`my_answer`/`my_problem`. The `awaiting_response` and `waiting_since` rules are tested, including `pharmacy_assigned_at` for routed items. Unknown query keys → 400 (existing test still passes).
  6. ✅ Courier: per-item `pharmacy_id`/`answers`, plus `pharmacy_answers_complete`, `confirmed_total`, `unavailable_count`, `answered_count` and `item_count` come from one SQL with LATERAL (one execute asserted). Step-3 PATCH → 400 «Этот шаг отмечается ответом аптеки». Manual steps are {1, 2, 6}, and a stored step-3 row is ignored (Python, the SQLite CASE test, and the TS checklist tests).
  7. ✅ UI: the pharmacy card shows a chip column, the answer form and «Передано в Ватан 2: N поз.». It renders no controls without `order_item_id` (`pharmacyOrderView.canAnswer`, tested). The form shows a Russian error and calls `router.refresh()` on 403/404/409. Courier detail shows a per-item label, «Подтверждённая сумма: X сом» or «Сумма ещё не подтверждена аптекой», derived step 3, and a warning beside step 4. The list shows «Ответ аптек: N из M». Admin quantity or base-price edits clear the answer (unit tests; client-price-only edits keep it). Checked by build and lint only, not in a browser.
  8. ✅ Gates: see below.
- Tests run (in the worktree, after `npm ci`):
  - `npm run test:frontend` → 97/97 pass
  - `npm run lint` → clean
  - `npm run build` → success (run on 04d6410; 0df81c0 is docs-only)
  - `python3 -m unittest discover -s backend/tests -t .` → 310 tests, only the 2 known main failures (`test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`)
- Decisions and interpretations (for reviewers):
  - Problem text for `unavailable` is optional. If given, it must be 3–300 chars (same bound as `price_differs`). An empty or whitespace string counts as absent. For `available`, any non-null `problem` → 400. TS mirrors this.
  - Check order inside the transaction: order missing or non-website → 404; no item assigned to this pharmacy → 404; status ≠ pending → 409; then per item 404 or 403.
  - Courier item pharmacy uses the courier's existing order-level fallback (pharmacy-created orders → creator), which equals the spec formula for website orders.
  - `pharmacy_answers_complete` is false for an order with 0 items.
  - Invalidation also covers the admin "add an existing medicine again" path (`add_courier_order_items` quantity increase), as "any website-order quantity edit". The courier's own-order edit path is not touched, because those orders never have answers.
  - Extra courier fields `answered_count`/`item_count` were added for the «Ответ аптек: N из M» line.
- Open questions / not done:
  - ESCALATE (from spec): apply 0024 to RDS first, then deploy the Lambda, then Vercel. Without 0024, the new Lambda breaks both the pharmacy and the courier order lists. None of this was done here.
  - The `pharmacy_web` policy is shared by «Ватан 1» and «Ватан 2». Telegram notifier is unchanged: «Ватан 2» gets no message about routed items (job 012).
  - UI was not checked in a browser or at 360 px. Only build, lint and unit tests were run.

## Round 2
- Commits: 79fe32e fix(staff): job 010 UI review — tokens, hover/focus states, step-4 warning layout
- Changed: `src/app/staff/staff.css`, `src/app/staff/orders/PharmacyAnswerForm.tsx`, `PharmacyOrderCard.tsx`, `[order_id]/CourierOrderDetail.tsx`, `src/lib/pharmacy-answers.ts`, `tests/pharmacy-answers.test.ts`
- Review findings addressed (round-1/review-ui.md, the only CHANGES verdict; code, security and UX were PASS):
  1. Hard-coded colours → `.staff-shell` tokens (`--c-ok`, `--c-ok-soft`, `--c-brand`, `--c-brand-dark`, `--c-brand-soft`, `--c-blue`, `--c-blue-soft`, `--c-amber`, `--c-amber-soft`, `--c-line`, `--c-muted`, `--c-bg`, `--c-card`, `--c-ink`). The job-010 block has no hex colours left. `.c-confirmed` now uses tokens, like `.c-confirmed.ok`. The duplicate `.pa-chip-*` tones were merged into one shared `.pa-tone-*` set (the reviewer's note).
  2. `.pa-btn:hover:not(:disabled) { filter: brightness(.95) }` and `.pa-btn:focus-visible` outline added.
  3. `.pa-option:hover { border-color: var(--c-muted) }` added.
  4. The step-4 warning is now a `<small class="c-check-warning">` inside `.c-check-text`, so it follows the text column. The fixed 52px margin and its 380px override were removed.
  - UX note (review-ux.md): if every item is unavailable (`confirmed_total` 0 and `unavailable_count` covers all items), the courier now sees «Все позиции недоступны — свяжитесь с клиентом» instead of «Подтверждённая сумма: 0 сом», and `isAmountConfirmed` is false (amber block, step-4 warning stays). Tests added.
  - UX note: the error alert in `PharmacyAnswerForm` gets `tabIndex={-1}` and is focused when an error appears.
  - Not changed: `.pa-btn-problem` stays brand-red outlined. The reviewer called it acceptable, and it matches the owner's two-step wording.
- Acceptance criteria: unchanged from round 1. The UI fixes are visual or copy only, and backend and Lambda were not touched.
- Tests run (worktree):
  - `npm run test:frontend` → 97/97 pass
  - `npm run lint` → clean
  - `npm run build` → exit 0
  - Backend suite not rerun, because no Python changed since round 1 (310 tests, only the 2 known main failures).
- Open questions / not done: the round-1 items still stand (deploy order 0024 → Lambda → Vercel; shared `pharmacy_web`; no Telegram message for «Ватан 2»). The 360/390 px layout has still not been checked in a browser.

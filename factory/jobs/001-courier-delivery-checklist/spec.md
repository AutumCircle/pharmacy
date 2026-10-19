# 001-courier-delivery-checklist: Courier delivery checklist inside each website order

## Goal
The courier (staff account 3, `/staff/orders`) gets an 8-step delivery checklist inside the card of
every website order (`website_order = true`). The checklist leads the courier through the order step
by step and shows what is already done. Checks are saved per order in RDS through Lambda, so they
are still there after the card is closed and reopened, or opened on another device. The courier
order list shows short progress, «4 из 8 шагов», and the next action. Checklist steps are internal
to the courier. They never become new order statuses, and the customer-facing tracking page does
not change.

## Scope
- **Migration** `db/migrations/0023_order_courier_checklist.sql` (additive, idempotent,
  `BEGIN/COMMIT`, same style as 0018): new table `order_courier_checklist (order_id integer
  REFERENCES orders(id), step smallint CHECK (step BETWEEN 1 AND 8), completed_at timestamptz NOT
  NULL DEFAULT now(), completed_by text NOT NULL, PRIMARY KEY (order_id, step))`. No change to the
  `orders.status` CHECK or to `order_status_history`.
- **Lambda** `backend/v1/admin_api/lambda_function.py`:
  - `_COURIER_ORDER_SELECT` also returns `checklist_steps` (a sorted int array of completed manual
    steps, `[]` if none). It is aggregated in SQL (LATERAL/subquery), not N+1.
  - New `update_courier_order_checklist(order_id, payload, request_id)` and the route
    `PATCH /v1/staff/orders/{order_id}/checklist` with body `{ "step": 1..8, "done": bool }`.
    Guard: `staff_accounts.session_account(event, courier=True)`. Strict payload keys.
    `ORDER_NOT_FOUND` 404 for a missing or deleted order. `409 ORDER_STATUS_CONFLICT` for a
    cancelled order. `409 CHECKLIST_NOT_AVAILABLE` for an order that is not a website order. The
    write is an idempotent upsert/delete with parameterized SQL and adds an `admin_audit_log` row
    with action `courier.order.checklist_updated`. The response is
    `{ order_id, checklist_steps }`.
  - Status-linked steps (3, 6, 8) cannot be stored manually and get `400 VALIDATION_ERROR`
    (see below).
- **Next.js:** new route `src/app/api/staff/orders/[order_id]/checklist/route.ts`. Copy the
  pattern of `status/route.ts`: session cookie, `order_id` regex, strict body validation, Russian
  errors, `Cache-Control: no-store`. Add a function to `src/lib/api-v1/staff-server.ts` and add
  `checklist_steps: number[]` to `CourierOrder` in `src/lib/api-v1/staff-types.ts`.
- **Pure logic:** new `src/lib/courier-checklist.ts`:
  - the 8 step definitions, with Russian titles and short hints taken from the feature text;
  - `isStepDone(order, step)`;
  - `checklistProgress(order) -> { done, total: 8, next }`.

  Status-linked steps are derived from `order.status`:
  - step 3 is done when status ∈ {confirmed, delivering, delivered};
  - step 6 is done when status ∈ {delivering, delivered};
  - step 8 is done when status = delivered.

  Manual steps 1, 2, 4, 5, 7 come from `checklist_steps`.
- **UI:**
  - In `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx`, add a checklist section next to
    the address, items, totals and status. It is shown only for website orders that are not
    cancelled.
    - Manual steps are checkboxes that save on change, with an optimistic update and a rollback
      plus Russian error on failure.
    - Status-linked steps show a button that calls the existing status endpoint:
      - step 3: pending→confirmed;
      - step 6: confirmed→delivering;
      - step 8: delivering→delivered.
    - Step 1 sits next to the existing courier delivery-fee field (`FeeSection`), or links to it.
  - In `src/app/staff/orders/CourierOrderList.tsx` (and in `src/app/staff/orders/page.tsx` if it
    renders its own rows), website orders show «N из 8 шагов · <следующее действие>».
  - Styling goes in `src/app/staff/staff.css`.
- **Docs:** add the new route, the `checklist_steps` field and the migration to `API_CONTRACT.md` §8.1.2.
- **Tests:** `tests/courier-checklist.test.ts`, added to the `test:frontend` script in
  `package.json`. Extend `backend/tests/test_courier_orders.py`.
- **Out of scope:**
  - no new values in `orders.status`;
  - no changes to `src/app/tracking/*`, public API, admin UI, Telegram notifier,
    `backend/local-agent/agent.py`, `backend/lambda-legacy`, API Gateway config;
  - no checklist for courier-created (own) orders;
  - no separate checklist tab.

## Acceptance criteria
1. The migration `0023_order_courier_checklist.sql` is additive and safe to re-run (`IF NOT
   EXISTS`). It does not alter `orders` columns or status constraints.
2. `PATCH /v1/staff/orders/{id}/checklist` with `{step: 2, done: true}` on a website order persists
   the step. A following `GET /v1/staff/orders/{id}` and the `GET /v1/staff/orders` list return
   `checklist_steps` containing `2`. `done: false` removes it. Repeating the same request is a
   no-op success.
3. The Lambda returns the following errors:
   - unknown keys, a non-integer step, a step outside 1–8, or a status-linked step 3/6/8 →
     `400 VALIDATION_ERROR`;
   - a cancelled order → `409 ORDER_STATUS_CONFLICT`;
   - a non-website order → `409 CHECKLIST_NOT_AVAILABLE`;
   - a missing order → `404`;
   - a non-courier staff session → rejected by `session_account(courier=True)`.

   Every successful change writes `courier.order.checklist_updated` to `admin_audit_log`.
4. `checklistProgress` gives these results:
   - a `pending` order with `checklist_steps: [1, 2]` → `{done: 2, total: 8, next: step 3}`;
   - a `delivered` order with all manual steps → `{done: 8, next: null}`;
   - a `delivering` order with `[]` → `done` = 2 (steps 3 and 6 are derived).
5. The courier order card for a website order shows all 8 steps in Russian and in order, with
   completed steps visually marked. After a page reload the checks are still there. Pressing the
   step 6 button moves the order to `delivering` through the existing status endpoint, and the 409
   conflict handling stays as it is.
6. The courier order list shows «N из 8 шагов» and the next step title for website orders. Own
   orders show no checklist.
7. No checklist text or step appears on `/tracking`. `CourierOrderStatus` and
   `order_status_history` values are unchanged. `rg "order_courier_checklist" src` returns nothing,
   which shows there is no SQL in Next.js.
8. `npm run lint`, `npm run build`, `npm run test:frontend` and
   `python -m unittest discover backend/tests` pass.

## Tests
- `tests/courier-checklist.test.ts` (`node --test`) asserts:
  - there are 8 steps, numbered 1–8, with non-empty Russian titles;
  - steps 3, 6 and 8 are derived from status;
  - the progress counts and the `next` step match criterion 4;
  - a cancelled order or an own order gives no checklist (`null`/hidden).
- `backend/tests/test_courier_orders.py` (with mocked `transaction`, existing `_tx` helper) asserts:
  - the upsert and delete SQL are parameterized;
  - the audit row is written;
  - validation errors for bad payloads and steps 3/6/8;
  - 409 for cancelled and for non-website orders;
  - 404 for a missing order;
  - `checklist_steps` is present in the `_COURIER_ORDER_SELECT` projection, and
    `get_courier_order` / `list_courier_orders` pass it through.

## Risks
- **Status mapping (owner decision needed).** The owner names four customer statuses: «Подтверждён»,
  «Собирается», «В пути», «Доставлен». The code has
  `pending('Новый'/'В обработке') → confirmed('Собирается'/'Сборка') → delivering → delivered`, so
  «Подтверждён» and «Собирается» both map to the single `confirmed` status. This spec makes step 3
  do pending→confirmed and keeps step 4 checklist-only, with no status change. Adding a real
  separate «Подтверждён» status would change the customer-facing status set, the DB CHECK
  constraints and tracking. That is out of scope and must be escalated, not improvised.
- **Migration.** A new migration has to be applied to live RDS before the Lambda deploy. Otherwise
  the courier select fails on the missing table and the whole courier order list breaks. The
  approver must escalate: take a backup, validate on staging, apply 0023, then deploy Lambda, then
  Vercel. The builder must not run the migration or deploy.
- **Lambda/RDS boundary.** All persistence goes through Lambda. Next.js only proxies with the
  server-side staff session, and the browser gets no API key. Do not trust the client for the
  status-derived steps.
- **Security.** Enforce the courier role in Lambda, not only in UI or middleware. Validate
  `order_id` with the existing regex on both layers.
- **Russian copy.** Step titles and errors are in Russian. Keep the status labels consistent with
  `status.ts`.
- **Windows 7 agent.** Not affected: `backend/local-agent/agent.py` is not touched.
- **API Gateway.** The new route is covered by the existing `ANY /v1/staff/{proxy+}`, so no gateway
  change is needed.

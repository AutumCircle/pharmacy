# 011-pharmacy-assembly-marks: «Начать сборку» / «Собран» per pharmacy after the order is agreed, visible to the courier

## Owner request (verbatim)
Source: `factory/requests/2026-10-16-pharmacy.md`.

> Действия фармацевта: сначала выбрать «В наличии, цена верна» либо «Нет в наличии / цена отличается» с указанием проблемы. После согласования заказа — «Начать сборку», затем «Собран». Курьер должен видеть результат каждого действия, чтобы не звонить клиенту с неподтверждённой суммой.

Действующие решения владельца (дословно):

> - Выполнять по очереди отдельными задачами: экран аптеки → действия фармацевта → оповещения (решение от 2026-10-15).
> - Статусы заказа для клиента не менять (pending → confirmed → delivering → delivered). «Начать сборку» и «Собран» — внутренние отметки аптеки, видимые курьеру.
> - Чек-лист курьера v2 (задача 003) уже в production: шаг 3 «Получить подтверждение наличия и цены» сейчас ручная отметка курьера.

Решения владельца 2026-10-16 (действия фармацевта и «Ватан 2»), дословно:

> - Если лекарств нет в «Ватан 1», они должны отправляться в «Ватан 2» (дословно: «Аптека 2 - when the medicines are not available in vatan_1 they should be sended to vatan_2»).
> - Во «Ватан 2» уходят ТОЛЬКО недостающие позиции; остальное собирает «Ватан 1». Курьер забирает из двух аптек.
> - Перенаправление АВТОМАТИЧЕСКОЕ: сразу после ответа фармацевта «Ватан 1» «Нет в наличии» по этим позициям они появляются у «Ватан 2».

This is follow-up **011 Сборка** from `factory/jobs/010-pharmacist-actions-routing/spec.md`. Job 010
(answers, per-item routing, migration 0024) is live in production.

## Goal
After job 010, each pharmacy answers availability per item. The courier agrees the order with the
client (`pending → confirmed`), but he still does not know when each pharmacy has its part ready.
After this job, every pharmacy that holds items of a **confirmed** website order («Ватан 1» and/or
«Ватан 2» after routing) taps «Начать сборку» and then «Собран» for **its own part**. The courier
sees each pharmacy's mark in the order list and in the order card, for example «Ватан 1: собран»,
«Ватан 2: собирается». He knows where to pick up and when. Customer statuses and `/tracking` do not
change.

### Interpretation (decisions pinned by this spec)
- **Mark per (order, pharmacy).** The states are `assembling` («Собирается») and `assembled`
  («Собран»). No row means «Ждёт сборки». The transitions are forward only:
  - none → `assembling`;
  - `assembling` → `assembled`.

  Skipping («none → assembled») or going back gives `409`. Repeating the current state is an
  idempotent no-op. Undoing a mark is out of scope (see Risks).
- **Who can mark.** A pharmacy can mark only when all of these hold:
  - the session is a pharmacy session (accounts 1 and 2), and the pharmacy id comes from the session only;
  - the order is a live website order (`created_by_staff_account_id IS NULL`, not deleted);
  - `orders.status = 'confirmed'`;
  - the pharmacy has at least one **assemblable item**. An assemblable item is effectively assigned
    to this pharmacy (`COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)`, as in
    010), and this pharmacy's answer for it is not `unavailable`.

  An unanswered item counts as assemblable, because older orders may have been confirmed without
  answers. A «Ватан 2» whose only items are «нет ни в одной аптеке» has nothing to assemble.
- **Assembly pharmacies of an order** = the distinct effective pharmacies of its assemblable items.
  `assembly_complete` = `status` is `confirmed`, and every assembly pharmacy has `assembled`.
- **Courier checklist step 5** («Забрать собранный заказ и выехать…») stays status-derived
  (`confirmed → delivering`, «Выехал»). It is **not blocked**. While the order is `confirmed` and
  `assembly_complete` is false, the courier card shows a warning next to step 5 and the «Выехал»
  action: «Не все аптеки отметили «Собран»». Lambda does not check marks on status changes.
- **After `confirmed`.** Marks are kept as they are and shown read-only to the courier. The
  pharmacy queue already hides orders after `confirmed`.

## Scope
- **New migration `db/migrations/0025_order_pharmacy_assembly.sql`** (additive, re-runnable, `BEGIN/COMMIT`).
  It creates table `order_pharmacy_assembly`:
  - `order_id`: same type as `orders.id`, read from the catalogue as 0024 does. FK with `ON DELETE CASCADE`;
  - `pharmacy_id smallint` with CHECK `IN (1, 2)`;
  - `state text` with CHECK `IN ('assembling', 'assembled')`;
  - `started_at timestamptz NOT NULL DEFAULT now()`;
  - `assembled_at timestamptz NULL`, with CHECK `(state = 'assembled') = (assembled_at IS NOT NULL)`;
  - `updated_by text NOT NULL`;
  - `PRIMARY KEY (order_id, pharmacy_id)`.

  No changes to `orders`, `order_items`, `order_status_history` or existing data.
- `backend/v1/admin_api/lambda_function.py`:
  - new `mark_pharmacy_assembly`, behind `POST /v1/staff/orders/{order_id}/assembly` with
    `session_account(pharmacy=True)`. The body is exactly `{"state": "assembling" | "assembled"}`;
  - `list_pharmacy_preparation_orders` adds two ungated fields with no client data:
    - `assembly_state`: `null`, `assembling` or `assembled`;
    - `assembly_available`: `true` when status is `confirmed` and this pharmacy has an assemblable item;
  - `_COURIER_ORDER_SELECT` / `_courier_order_row` add:
    - `assembly`: a list of `{pharmacy_id, state: 'waiting' | 'assembling' | 'assembled', started_at, assembled_at}`,
      one entry per assembly pharmacy, sorted by `pharmacy_id`. It is `[]` for orders that are not website orders;
    - `assembly_complete`: a boolean.

    Use LATERAL aggregation, with no N+1 queries.
- `src/app/api/staff/orders/[order_id]/assembly/route.ts`: new proxy, same pattern as `pharmacy-answers/route.ts`.
  Also add a client function in `src/lib/api-v1/staff-server.ts` and new fields in `src/lib/api-v1/staff-types.ts`.
- New pure helper `src/lib/pharmacy-assembly.ts`:
  - request validation that mirrors Lambda;
  - Russian labels: «Ждёт сборки», «Собирается», «Собран»;
  - `nextAssemblyAction(order)`, which returns «Начать сборку», «Собран» or null;
  - `courierAssemblyLines(order)`, which returns lines like «Ватан 1: собран» and «Ватан 2: собирается»;
  - `assemblyWarning(order)`.
- `src/app/staff/orders/PharmacyOrderCard.tsx` plus a new client component `PharmacyAssemblyButtons.tsx`.
  It shows the next action button and the current mark chip, and calls `router.refresh()` after success.
- `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx`: a block with the pharmacy marks, and the
  step-5 / «Выехал» warning. `src/app/staff/orders/CourierOrderList.tsx`: a short marks line for `confirmed` orders.
- `src/app/staff/staff.css`: chip and button styles, readable at 360 px.
- `package.json`: add `tests/pharmacy-assembly.test.ts` to `test:frontend`.
- `API_CONTRACT.md` §8.1.2 / §8.1.2a: the endpoint, fields and rules, plus the 0025 rollout order.
- **Out of scope:**
  - customer statuses, `/tracking` and the public API;
  - notifications, push, sound and Telegram (job 012);
  - admin order screens, and admin edits resetting marks;
  - undoing a mark;
  - changes to the answer and routing logic from 010;
  - courier-created orders;
  - API Gateway (`/v1/staff/{proxy+}` covers the new path);
  - `backend/local-agent/agent.py`;
  - editing applied migrations 0001–0024.

## Acceptance criteria
1. **Migration.** `0025_order_pharmacy_assembly.sql` is the only new migration. It is additive only
   (`CREATE TABLE IF NOT EXISTS` and guarded constraints), contains no `DROP`, `UPDATE`, `DELETE` or
   `ALTER` of existing tables, and is wrapped in `BEGIN/COMMIT`.
2. **Endpoint validation and authorization (Lambda).** `POST /v1/staff/orders/{id}/assembly` returns:
   - courier session → 403;
   - any body other than exactly `{"state": "assembling"|"assembled"}` → 400 VALIDATION_ERROR,
     including a `pharmacy_id` key;
   - an unknown, deleted or non-website order, or an order where this pharmacy has no effectively
     assigned item → 404 ORDER_NOT_FOUND;
   - status ≠ `confirmed` → 409 ORDER_STATUS_CONFLICT «Сборка доступна после согласования заказа»;
   - all of this pharmacy's items answered `unavailable` → 409 «Нечего собирать»;
   - a skipped or backward transition → 409 ASSEMBLY_STATE_CONFLICT.

   The order row is locked `FOR UPDATE`, and nothing is written on any error.
3. **Writes, idempotency, audit.**
   - A valid transition upserts the `(order_id, session pharmacy)` row. `assembled` sets `assembled_at = now()`.
   - Repeating the current state writes nothing, writes no audit row and returns the same projection
     `{order_id, pharmacy_id, state, started_at, assembled_at}`.
   - Each change writes exactly one `admin_audit_log` row: `actor_id = 'staff:<N>'`,
     `action = 'pharmacy.order.assembly_marked'`, and details `{pharmacy_id, from_state, to_state}`,
     with no client data.
   - `orders.status` and `order_status_history` are never touched.
   - Pharmacy 1 can never write pharmacy 2's row: there is no input for it.
4. **Pharmacy queue.** In `GET /v1/staff/orders` for pharmacy N, each order carries
   `assembly_state` and `assembly_available`, as defined in Scope. Both are present whatever the
   `pharmacy_web` policy is. Unknown query keys still give 400. Job 010 fields are unchanged.
5. **Courier projection.** `GET /v1/staff/orders` and `GET /v1/staff/orders/{id}` for the courier
   return `assembly` and `assembly_complete` as defined.
   - Example: an order routed 1 → 2, where pharmacy 1 is `assembled` and pharmacy 2 has no row, gives
     `[{pharmacy_id: 1, state: 'assembled'}, {pharmacy_id: 2, state: 'waiting'}]` and `assembly_complete: false`.
   - A pharmacy whose items are all `unavailable` is not listed.
6. **UI.**
   - **Pharmacy card**, when `assembly_available` is true: shows «Начать сборку», then «Собран», then
     the chip «Собран». A 409 shows a Russian error and refreshes the card. With no
     `assembly_available` field (old Lambda), no buttons are rendered and nothing crashes.
   - **Courier detail**: shows one line per pharmacy («Ватан 1: собран», «Ватан 2: собирается»,
     «Ватан 2: ждёт сборки»).
   - **Courier list**: shows the same short line for `confirmed` orders.
   - **Step-5 warning**: «Не все аптеки отметили «Собран»» is shown next to step 5 and the «Выехал»
     action while the status is `confirmed` and `assembly_complete` is false. «Выехал» stays enabled.
   - With an old Lambda (no `assembly` field), the courier sees no marks and no warning.
   - `checklistProgress` is unchanged.
7. **Gates:** `npm run lint`, `npm run build`, `npm run test:frontend` and
   `python -m unittest discover -s backend/tests -t .` pass, apart from failures already known on main.

## Tests
- `backend/tests/test_pharmacy_assembly.py` (new; mocked cursor, same style as `test_pharmacy_answers.py`):
  - every AC2 case;
  - none → `assembling` → `assembled`, asserting the upsert SQL and args;
  - a skip and a backward transition give 409;
  - a repeat writes nothing and no audit;
  - the audit row has the AC3 shape and no PII;
  - the pharmacy id is taken from the session;
  - `orders.status` is never updated, and no SQL touches `order_status_history`.
- `backend/tests/test_staff_accounts.py` (extend): the pharmacy queue returns `assembly_state` and
  `assembly_available` (true only when `confirmed` with an assemblable item), and both survive an
  all-off `pharmacy_web` policy.
- `backend/tests/test_courier_orders.py` (extend): `assembly` and `assembly_complete` for:
  - a single pharmacy;
  - a 1 → 2 routed order;
  - a pharmacy with only unavailable items (excluded);
  - a courier-created order (`[]`).
- `tests/pharmacy-assembly.test.ts` (new):
  - request validation;
  - `nextAssemblyAction` for every state;
  - `courierAssemblyLines` labels;
  - `assemblyWarning`: shown only for `confirmed` and incomplete, absent for an old Lambda payload.
- `tests/pharmacy-order.test.ts` (extend): `pharmacyOrderView` exposes `assembly_state` and
  `assembly_available`, and degrades to no actions when they are absent.

## Risks
- **ESCALATE: migration + Lambda deploy.** This job adds `db/migrations/0025_order_pharmacy_assembly.sql`
  and changes the admin Lambda (`admin-api-v1.zip`). The required order is:
  1. apply 0025 to live RDS (one-shot VPC migration);
  2. deploy the Lambda;
  3. deploy Vercel.

  A new Lambda without 0025 breaks both the pharmacy and courier order lists (missing table).
  Neither step is part of this job. The approver must escalate both to the owner. The UI must
  tolerate the old Lambda response.
- **Authorization** is enforced only in Lambda: the session pharmacy id, an ownership check against
  the effective item assignment under `FOR UPDATE`, and no pharmacy id accepted from the body. The
  Next.js route only pre-validates.
- **No undo.** A mis-tapped «Собран» cannot be reverted by the pharmacy in this job. The courier sees it
  early. If the owner wants undo or an admin reset, that is a follow-up.
- **Admin edits after `confirmed`** (quantity or base price, which 010 allows at any status) do not
  reset the mark. «Собран» may then be stale. This needs to be said in the handover.
- **Not a gate.** The warning does not block «Выехал», per the owner's decision that statuses do not
  change. The courier can still leave before a pharmacy marks «Собран».
- **No notifications.** The courier and «Ватан 2» are not notified when a mark changes. They see it only
  on `/staff/orders` after a refresh (job 012).
- **Windows 7 agent:** not affected. `backend/local-agent/agent.py` must not change.
- **Russian copy:** all new labels are in Russian, with the pharmacy names «Ватан 1» / «Ватан 2». No
  customer-facing text changes.

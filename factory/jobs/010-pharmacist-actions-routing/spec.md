# 010-pharmacist-actions-routing: Pharmacist availability answers per item, automatic routing to «Ватан 2», answers visible to the courier

## Owner request (verbatim)
Source: `factory/requests/2026-10-16-pharmacy.md` (same text in `factory/requests/2026-10-15-courier-pharmacy.md`).

> Действия фармацевта: сначала выбрать «В наличии, цена верна» либо «Нет в наличии / цена отличается» с указанием проблемы. После согласования заказа — «Начать сборку», затем «Собран». Курьер должен видеть результат каждого действия, чтобы не звонить клиенту с неподтверждённой суммой.

Действующие решения владельца (дословно):

> - Выполнять по очереди отдельными задачами: экран аптеки → действия фармацевта → оповещения (решение от 2026-10-15).
> - Статусы заказа для клиента не менять (pending → confirmed → delivering → delivered). «Начать сборку» и «Собран» — внутренние отметки аптеки, видимые курьеру.
> - Чек-лист курьера v2 (задача 003) уже в production: шаг 3 «Получить подтверждение наличия и цены» сейчас ручная отметка курьера.

Решения владельца 2026-10-16 (действия фармацевта и «Ватан 2»), дословно:

> - Если лекарств нет в «Ватан 1», они должны отправляться в «Ватан 2» (дословно: «Аптека 2 - when the medicines are not available in vatan_1 they should be sended to vatan_2»).
> - Во «Ватан 2» уходят ТОЛЬКО недостающие позиции; остальное собирает «Ватан 1». Курьер забирает из двух аптек.
> - Перенаправление АВТОМАТИЧЕСКОЕ: сразу после ответа фармацевта «Ватан 1» «Нет в наличии» по этим позициям они появляются у «Ватан 2».

## Split
This request is too big for one shippable job. This spec covers **part 1**: the pharmacist's first
answer per item, automatic routing of unavailable items to «Ватан 2», and what the courier sees.
Follow-ups (not in this job):
- **011 Сборка:** «Начать сборку» and «Собран» per pharmacy per order, available once the order is
  `confirmed`. These are internal marks shown to the courier. They need their own small additive
  migration (0025) and no customer status change.
- **012 Оповещения:** notifications, repeat every ~3 min, push, sound (already planned separately).
- Admin order screen showing the pharmacy answers (optional, owner to decide).

## Goal
Today a pharmacy (accounts 1 and 2) can only look at its order cards (job 008), and the courier
ticks checklist step 3 «Получить подтверждение наличия и цены» by hand after a phone call. After
this job, for every item assigned to it, the pharmacist answers «В наличии, цена верна»,
«Нет в наличии» or «Цена отличается» (the last two with a problem text). An item that «Ватан 1»
marks «Нет в наличии» is moved automatically to «Ватан 2» in the same transaction, and only that
item moves. The courier sees each pharmacy's answer per item, which pharmacy holds each item, and
a server-computed **confirmed amount**. He knows whether he can call the client with a final sum.
Checklist step 3 is now derived from the answers. Customer statuses do not change.

### Interpretation (decisions pinned by this spec)
- **Per item, three answers.** The owner's second button «Нет в наличии / цена отличается» covers two
  different facts. They have different routing effects, so the API stores them separately as
  `unavailable` and `price_differs`. The UI shows the owner's two-step wording. The order-level
  button «В наличии, цена верна» answers `available` for all of this pharmacy's unanswered items.
  «Нет в наличии / цена отличается» opens a per-item choice: «Нет в наличии» or «Цена отличается».
  The problem text is **required for `price_differs`** (3–300 chars), optional for `unavailable`,
  and rejected for `available`.
- **Routing.** Only `unavailable` from pharmacy 1 routes, and it routes to pharmacy 2. **«Цена отличается»
  alone does NOT route.** The item stays at its pharmacy and the courier or admin settles the price
  with the client.
- **«Ватан 2» also lacks it.** `unavailable` from pharmacy 2 is final. The item stays assigned to
  pharmacy 2 with the state «Нет ни в одной аптеке». It never routes back to pharmacy 1 and never
  loops. The courier sees it and agrees a replacement or removal with the client. The admin
  removes or edits it with the existing tools. Items of an order originally assigned to
  pharmacy 2 do not route to pharmacy 1, because the owner only asked for 1 → 2.
- **Per-item assignment.** Effective pharmacy of an item =
  `COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)`. Existing rows keep `NULL`,
  so nothing changes for them. A pharmacy sees an order when at least one item is effectively
  assigned to it. It sees **only those items**, and `base_total` is summed over those items only.
  After routing, «Ватан 1» no longer sees the moved item. Its card shows one line
  «Передано в Ватан 2: N поз.» (count only).
- **When answers are allowed.** Answers are allowed only while `orders.status = 'pending'`, only for
  website orders (`created_by_staff_account_id IS NULL`), and only for items currently assigned to
  the session's pharmacy. A pharmacy may change its own answer while those conditions hold. Once
  pharmacy 1 routes an item away, pharmacy 1 can no longer change it.
- **`awaiting_response` (redefined, server-side).** It is `true` when the status is `pending` and this
  pharmacy has at least one assigned item without its own answer. `waiting_since` is the earliest
  `COALESCE(oi.pharmacy_assigned_at, o.created_at)` among those unanswered items. For «Ватан 2»,
  waiting therefore starts when the item was routed. When `awaiting_response` is false,
  `waiting_since` is still `created_at`.
- **Confirmed amount (courier).** `pharmacy_answers_complete` = every item of the order has an answer
  from its currently assigned pharmacy. `confirmed_total` is the client sum
  `SUM(oi.line_total)` of items whose current answer is `available`. It is returned **only** when the
  answers are complete and no item is `price_differs`; otherwise it is `null`. Items that are
  unavailable everywhere are excluded and counted in `unavailable_count`. All of this is computed
  in SQL. No price is accepted from any client.
- **Checklist step 3 becomes derived.** It is done when `pharmacy_answers_complete` is true or the
  status is in {confirmed, delivering, delivered}. The second condition keeps older orders
  consistent. Manual steps become {1, 2, 6}. A manual PATCH for step 3 gives `400 VALIDATION_ERROR`
  «Этот шаг отмечается ответом аптеки». Stored step-3 rows stay in the table and are ignored on read.
  «Согласовано» (`pending → confirmed`) is **not** blocked in Lambda; the courier UI only warns
  «Сумма ещё не подтверждена аптекой» next to step 4.
- **Admin edits invalidate answers.** If an admin edit through the existing website-order item
  tools changes an item's quantity or pharmacy (base) price, that item's answer at its current
  pharmacy is deleted, so the item must be answered again. The assignment is kept. Items added to a
  website order start unassigned, which means the order's pharmacy.

## Scope
- **New migration `db/migrations/0024_order_item_pharmacy_answers.sql`** (additive, re-runnable, in a transaction):
  - `order_items.fulfillment_pharmacy_id smallint NULL`, with CHECK `NULL or IN (1, 2)`;
  - `order_items.pharmacy_assigned_at timestamptz NULL`;
  - table `order_item_pharmacy_answers`:
    - `order_item_id`: same type as `order_items.id`, FK with `ON DELETE CASCADE`;
    - `pharmacy_id smallint` with CHECK `IN (1, 2)`;
    - `answer text` with CHECK `IN ('available', 'unavailable', 'price_differs')`;
    - `problem text NULL` with CHECK on length 1..300;
    - `answered_at timestamptz DEFAULT now()`;
    - `answered_by text NOT NULL`;
    - `PRIMARY KEY (order_item_id, pharmacy_id)`;
  - a partial index on `order_items(fulfillment_pharmacy_id)`.

  No changes to `orders.status`, `order_status_history` or existing data.
- `backend/v1/admin_api/lambda_function.py`:
  - **new `answer_pharmacy_order_items`** behind `POST /v1/staff/orders/{order_id}/pharmacy-answers`
    with `session_account(event, pharmacy=True)`. The pharmacy id comes from the session only.
    The function does locking, validation, routing and audit (see AC);
  - `list_pharmacy_preparation_orders`:
    - filters and projects per item using the effective assignment;
    - adds per-item `order_item_id`, `my_answer` and `my_problem`, plus `routed_away_count` and the redefined
      `awaiting_response` / `waiting_since`. These fields are not gated by the policy and contain no
      client data. The existing `pharmacy_web` gating stays as it is;
  - `_COURIER_ORDER_SELECT` / `_courier_order_row`:
    - per-item `pharmacy_id` (effective) and `answers` (list of `{pharmacy_id, answer, problem, answered_at}`);
    - order-level `pharmacy_answers_complete`, `confirmed_total` (decimal string or null) and `unavailable_count`;
    - no N+1 queries (use LATERAL aggregation);
  - checklist: `COURIER_CHECKLIST_MANUAL_STEPS = {1, 2, 6}`, the step-3 error, and the read mapping
    drops step 3;
  - existing admin item edit paths (`update_order_item_price`, `adjust_admin_order_item` and any
    website-order quantity edit) delete that item's current answer when quantity or the base price changes.
- `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts` (new proxy, same pattern as
  `checklist/route.ts`) and a `src/lib/api-v1/staff-server.ts` client function. `src/lib/api-v1/staff-types.ts`: new fields.
- New pure helper `src/lib/pharmacy-answers.ts` with:
  - request validation that mirrors Lambda;
  - Russian labels;
  - `courierItemAnswerLabel(item)`, for example «Ватан 1: в наличии», «Ватан 1: нет → Ватан 2»,
    «Ватан 2: нет в наличии», «Цена отличается: …», «Ждём ответ Ватан N»;
  - `confirmedAmountText(order)`.
- `src/app/staff/orders/PharmacyOrderCard.tsx` actions footer → new client component
  `src/app/staff/orders/PharmacyAnswerForm.tsx`, with a per-item answer column or chip on the card.
  Uses `router.refresh()` after success.
- `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx` shows:
  - the per-item pharmacy and answer;
  - «Подтверждённая сумма: X» or «Сумма ещё не подтверждена аптекой»;
  - step 3 as derived.

  `src/app/staff/orders/CourierOrderList.tsx` shows a short «Ответ аптек: N из M» line.
  `src/lib/courier-checklist.ts` makes step 3 derived, with the extra input `pharmacyAnswersComplete`.
- `src/app/staff/staff.css`: styles for answer chips (readable at 360 px).
- `API_CONTRACT.md` §8.1.2 / §8.1.2a: the new endpoint, fields, routing rules and step-3 rule.
  Add migration 0024 to the migration notes in `docs/PROJECT_CONTEXT.md` if it lists migrations.
- **Out of scope:**
  - «Начать сборку» / «Собран» (job 011);
  - notifications/push/sound and any Telegram notifier change (`backend/v1/telegram_notifier`);
  - customer statuses, `/tracking` and the public API;
  - admin order screens (except the answer invalidation on edit);
  - courier-created orders (they stay outside the pharmacy queue);
  - API Gateway (the existing `/v1/staff/{proxy+}` covers the new path);
  - `backend/local-agent/agent.py`;
  - editing already-applied migrations.

## Acceptance criteria
1. **Migration.** `0024_order_item_pharmacy_answers.sql` exists. It is the only new migration. It
   contains only additive DDL (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE/INDEX IF NOT EXISTS`, guarded
   constraints), has no `DROP`/`UPDATE`/`DELETE` of data, and is wrapped in `BEGIN/COMMIT`.
2. **Answer endpoint validation and authorization (Lambda).**
   `POST /v1/staff/orders/{id}/pharmacy-answers` returns:
   - courier session → 403;
   - body keys other than `answers` → 400. Each entry must have exactly `order_item_id` and `answer`,
     plus optional `problem`. Any price key gives 400;
   - empty list, more than 50 entries or duplicate item ids → 400;
   - `price_differs` without a problem, or a problem on `available` → 400;
   - an item of the order assigned to the other pharmacy → 403 FORBIDDEN;
   - an item id that is not in the order → 404;
   - an order with no item assigned to this pharmacy, or a non-website order → 404 ORDER_NOT_FOUND;
   - status ≠ `pending` → 409 ORDER_STATUS_CONFLICT.

   The order row is locked `FOR UPDATE`, and nothing is written on any error.
3. **Routing.** In one transaction, `unavailable` from pharmacy 1 sets the item's
   `fulfillment_pharmacy_id = 2` and `pharmacy_assigned_at = now()`. The item then appears in
   pharmacy 2's `GET /v1/staff/orders`, with `awaiting_response: true`, and disappears from
   pharmacy 1's list items (`routed_away_count` = 1). Other items of the order stay with pharmacy 1.
   `price_differs` from pharmacy 1 does not change the assignment. `unavailable` from pharmacy 2 does not
   change the assignment, and the courier sees the item as unavailable at both pharmacies.
4. **Idempotency and audit.** Repeating the same request (same answers and problems) changes no
   rows, writes no audit row and returns the same projection. Each request that changes something writes exactly one
   `admin_audit_log` row: `actor_id = 'staff:<pharmacy_id>'`,
   `action = 'pharmacy.order.items_answered'`, and details
   `{pharmacy_id, items: [{order_item_id, answer}], routed_to_pharmacy_2: [ids]}`, with no client
   name, phone or address. `orders.status` and `order_status_history` are never touched.
5. **Pharmacy queue.** `GET /v1/staff/orders` for pharmacy N:
   - returns only orders with at least one item effectively assigned to N;
   - lists only those items;
   - computes `base_total` over those items;
   - adds per item `order_item_id`, `my_answer` and `my_problem`.

   `awaiting_response` and `waiting_since` follow the Interpretation rules: true until every
   assigned item is answered, then false. Unknown query keys still give 400. Existing `NULL`-assignment
   orders behave exactly as in job 008.
6. **Courier projection and step 3.** `GET /v1/staff/orders` and `GET /v1/staff/orders/{id}` for the
   courier return:
   - per item: `pharmacy_id` and `answers`;
   - per order: `pharmacy_answers_complete`, `confirmed_total` and `unavailable_count`. `confirmed_total`
     is `null` while answers are incomplete or while any item is `price_differs`; otherwise it is the SQL sum of
     `line_total` over available items, as a decimal string.

   The step-3 PATCH gives 400 «Этот шаг отмечается ответом аптеки». `checklistProgress` counts step 3
   as done exactly when `pharmacyAnswersComplete` is true or the status is past `pending`.
7. **UI.**
   - **Pharmacy card:** «В наличии, цена верна» answers all of this pharmacy's unanswered items.
     «Нет в наличии / цена отличается» opens a per-item choice with a problem field. Answered items
     show a coloured chip. A 403/409 shows a Russian error and refreshes the card. With an old
     Lambda response (no `order_item_id`), no action controls are rendered and nothing crashes.
   - **Courier detail:** shows each item's pharmacy and answer label, plus «Подтверждённая сумма: X сом»
     or «Сумма ещё не подтверждена аптекой».
   - **Admin edits:** an admin edit of quantity or base price clears that item's current answer.
     This is covered by a unit test.
8. **Gates:** `npm run lint`, `npm run build`, `npm run test:frontend` (or `node --test tests/`) and
   `python -m unittest discover -s backend/tests -t .` pass, apart from the 2 failures already known on main.

## Tests
- `backend/tests/test_pharmacy_answers.py` (new; mocked cursor, same style as `test_staff_accounts.py`):
  - every AC2 validation and authorization case;
  - routing 1→2 (assert the UPDATE SQL and args);
  - `price_differs` and pharmacy-2 `unavailable` do not route;
  - a repeated request writes no audit row;
  - the audit row has the AC4 shape and contains no PII;
  - the pending-only rule (409);
  - the handler passes the session `account_id` and ignores any `pharmacy_id` in the body (400).
- `backend/tests/test_staff_accounts.py` (extend):
  - the pharmacy queue SQL uses the effective item assignment and the per-item filter;
  - `awaiting_response` is true with one unanswered item and false when all are answered;
  - `waiting_since` uses `pharmacy_assigned_at` for routed items;
  - `routed_away_count`.
- `backend/tests/test_courier_orders.py` (extend):
  - `confirmed_total` is null when incomplete or `price_differs`, and equals the decimal sum when complete;
  - `unavailable_count`;
  - step-3 PATCH → 400;
  - manual steps are {1, 2, 6}, and a stored step-3 row is ignored on read.
- `backend/tests/test_admin_order_item_adjustments.py` (extend): changing quantity or base price deletes that
  item's answer, and changing only the client selling price does not.
- `tests/courier-checklist.test.ts` (update):
  - pending, `[1, 2]`, answers incomplete → `done 2, next step 3`;
  - same with answers complete → `done 3, next step 4`;
  - confirmed with no answers → step 3 counted done.
- `tests/pharmacy-answers.test.ts` (new):
  - request validation mirrors Lambda (problem rules, no price keys, max 50, no duplicates);
  - `courierItemAnswerLabel` covers all states, including «нет ни в одной аптеке»;
  - `confirmedAmountText` covers null and value cases.
- `tests/pharmacy-order.test.ts` (extend): `pharmacyOrderView` exposes `order_item_id`/`my_answer` and
  degrades to «no actions» when they are absent.

## Risks
- **ESCALATE: migration + Lambda deploy.** This job adds `db/migrations/0024_order_item_pharmacy_answers.sql`
  and changes the admin Lambda (`pharmacy-heartbeat-handler`, `admin-api-v1.zip`). The required order is:
  1. apply 0024 to RDS (one-shot VPC migration);
  2. deploy the Lambda;
  3. Vercel.

  A new Lambda without the migration breaks both the pharmacy and courier order lists (missing
  columns). Neither step is part of this job. The approver must escalate both to the owner. The
  Next.js UI must tolerate the old Lambda response (no answer fields → no controls, step 3 falls back to «not done
  while pending»). Courier step 3 can then no longer be ticked by hand. If the Vercel deploy goes out
  before the Lambda, step 3 shows as not done until the order is confirmed. Deploy them together, or
  deploy the Lambda first.
- **Pharmacy 2 starts receiving website order items** for the first time. The `pharmacy_web` policy is one
  channel for both pharmacies. If the owner has turned on phone, address or client totals for
  `pharmacy_web`, «Ватан 2» will see them for routed orders too. The approver should confirm this
  with the owner. Splitting `pharmacy_web` per pharmacy would be a separate job.
- **Telegram notifier is not changed.** The courier's «переслать в аптеку» copy and the pharmacy Telegram
  message still name the order-level pharmacy (`fulfillment_pharmacy_id`, default 1) and list all items.
  «Ватан 2» gets no Telegram or push message when items are routed. It only sees them on
  `/staff/orders` until job 012. The courier must check the screen. This needs to be said in the handover to the owner.
- **Authorization** is enforced only in Lambda:
  - the pharmacy id comes from the HMAC session (`staff_accounts.session_account(pharmacy=True)`);
  - item ownership is checked against the effective assignment under `FOR UPDATE`;
  - no price or pharmacy id is accepted from the body.

  `src/proxy.ts` and the Next.js route only pre-validate.
- **Concurrency.** Two pharmacists, or a pharmacist and an admin edit, act at the same time. The order-row lock
  serializes them. Routing and answer writes are in the same transaction, so there is no state where an item is half-routed.
- **Behaviour change for the courier.** Step 3 is no longer manual. Existing step-3 ticks are ignored, but older
  orders past `pending` still show step 3 done.
- **Windows 7 agent:** not affected. `backend/local-agent/agent.py` must not change, and catalogue sync is untouched.
- **Russian copy:** all new labels are in Russian. The pharmacy names in the UI are «Ватан 1» / «Ватан 2». No customer-facing text changes.

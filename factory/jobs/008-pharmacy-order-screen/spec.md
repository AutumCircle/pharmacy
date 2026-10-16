# 008-pharmacy-order-screen: Экран аптеки — читаемая карточка заказа на сборку

## Owner request (verbatim)

Экран аптеки: показывать номер и дату заказа, а лекарства — в читаемой таблице: название, количество, цена, сумма по позиции и итоговая сумма. Важные данные выделить цветом. У каждой аптеки должны отображаться только относящиеся к ней позиции. Показать, сколько минут заказ ожидает обработки.

## Действующие решения владельца
- Выполнять по очереди отдельными задачами: экран аптеки → действия фармацевта → оповещения (решение от 2026-10-15).
- Статусы заказа для клиента не менять (pending → confirmed → delivering → delivered). «Начать сборку» и «Собран» — внутренние отметки аптеки, видимые курьеру.
- Чек-лист курьера v2 (задача 003) уже в production: шаг 3 «Получить подтверждение наличия и цены» сейчас ручная отметка курьера.

## Goal
Pharmacy staff (accounts 1 and 2, role `pharmacy`) open `/staff/orders` and today see a plain
bullet list per order. Replace it with a card per order that shows the order number and date, a
readable table of medicines (name, quantity, pharmacy price, line sum) with a total row, the
order status, and a live "ожидает N мин" counter, with key values colour-highlighted. Each
pharmacy sees only orders assigned to it, and never client identity or address. The card has
a reserved actions area so the next jobs (pharmacist actions, notifications) can be added without
rework.

### Decisions pinned by this spec
- **Which items belong to which pharmacy.** There is no per-item assignment today. Assignment is
  per order: `orders.fulfillment_pharmacy_id` (migration 0017; `NULL` = pharmacy 1). Website orders
  are created with `NULL` (pharmacy 1; the catalogue is one shared snapshot from one pharmacy PC).
  Courier-created orders choose pharmacy 1 or 2 but are excluded from the pharmacy queue
  (`created_by_staff_account_id IS NULL`), per the rollout policy. So "positions relevant to the
  pharmacy" = all items of orders where `COALESCE(o.fulfillment_pharmacy_id, 1) = <session account_id>`.
  This filter already exists in `list_pharmacy_preparation_orders`; this job keeps it and adds a
  test that pharmacy 2 never gets pharmacy 1's orders. Splitting one order across two pharmacies
  (per-item `order_items.pharmacy_id`) needs a migration and is **out of scope**. As a result,
  pharmacy 2's queue stays empty until orders are assigned to it.
- **Price shown.** The pharmacy sees the **pharmacy (base) price**: `COALESCE(oi.base_unit_price, oi.price)`,
  base line total and `base_total`. This is the same rule as the existing pharmacy Telegram policy. The pharmacy never sees the client
  selling price, client total or profit by default. Price fields stay gated by the `pharmacy_web`
  policy (`item_base_total` gates unit price and line sum, `base_total` gates the total). To meet the request,
  `item_base_total` and `base_total` are added to `DEFAULT_ENABLED["pharmacy_web"]`. If the owner has
  saved settings that turn them off, the price columns and total are hidden (not shown as 0).
- **Waiting time.** Start = `orders.created_at`. Until the pharmacist-actions job exists,
  "processed" means the order has left status `pending` (the courier or admin pressed «Согласовано»,
  so `pending → confirmed`). Lambda returns two fields that the policy does not gate and that contain no client data:
  `waiting_since` (ISO, = `created_at`) and `awaiting_response` (bool, = `status == 'pending'`). The UI
  shows «Ожидает обработки N мин» only when `awaiting_response` is true. The pharmacist-actions job
  will redefine `awaiting_response` server-side (stop counting at the pharmacist's first answer)
  without UI changes.
- **Privacy.** The pharmacy screen must not render `customer_name`, `phone`, `address`, `landmark`,
  `profit`, client totals or the creator, even if the policy returns them. Lambda keeps stripping them
  under the default policy.

## Scope
- `backend/v1/admin_api/lambda_function.py` → `list_pharmacy_preparation_orders`: add
  `base_unit_price` per item (gated by `item_base_total`, decimal from SQL, not derived in JS),
  `waiting_since`, `awaiting_response`. Keep the existing filter, ordering, pagination and policy logic.
- `backend/v1/shared/order_notification_settings.py`: add `item_base_total`, `base_total` to the
  `pharmacy_web` defaults. Update the admin preview if it lists pharmacy_web defaults.
- `src/lib/api-v1/staff-types.ts`: extend `PharmacyPreparationOrder` (`waiting_since`,
  `awaiting_response`, item `base_unit_price`).
- New `src/app/staff/orders/PharmacyOrderCard.tsx` (server-renderable card + table, with an empty
  `actions` slot/footer region for the next job), new small client component
  `src/app/staff/orders/WaitingMinutes.tsx` (re-renders every 30 s), pure helper
  `src/lib/pharmacy-order.ts` (`waitingMinutes(since, now)`, `waitingLevel(minutes)`).
- `src/app/staff/orders/page.tsx` pharmacy branch: use the card and drop the client identity, address and finance lines.
- `src/app/staff/staff.css`: table and highlight styles. It must stay readable at 360 px width; the table may
  scroll horizontally inside the card.
- `API_CONTRACT.md`: document the new response fields and the price and waiting rules.
- **Out of scope:** pharmacist action buttons and endpoints, any new order status or column,
  notifications/push/sound, the courier screens and checklist, per-item pharmacy assignment,
  public checkout, `backend/local-agent/agent.py`, DB migrations.

## Acceptance criteria
1. `GET /v1/staff/orders` with a pharmacy session returns only orders where
   `COALESCE(fulfillment_pharmacy_id, 1)` equals the session `account_id`. The id comes from the
   Lambda-verified session, never from the query; unknown query keys still return `VALIDATION_ERROR`.
2. Under default policy each returned order contains `order_reference`, `created_at`, `status`,
   `waiting_since`, `awaiting_response`, and `medicines[]` with `medicine_name`, `quantity`,
   `base_unit_price`, `base_line_total`, plus `base_total`. It contains **no** `customer_name`, `phone`,
   `address`, `landmark`, `order_total`, `line_total`, `profit`, `created_by_staff_account_id`.
   With `item_base_total`/`base_total` disabled in saved policy, those price fields are absent.
3. `awaiting_response` is `true` for `pending` and `false` for `confirmed`. `waiting_since` equals the
   order's `created_at` in the same ISO format.
4. Each pharmacy card shows «Заказ <номер>» and the date/time in Asia/Dushanbe. It has a table with headers
   «Лекарство», «Кол-во», «Цена», «Сумма» and an «Итого» row from `base_total`. Money uses `money()`,
   quantity uses `quantityLabel()`. If price fields are absent, the price columns and total row are not rendered.
5. Waiting badge «Ожидает обработки N мин» is shown only when `awaiting_response`. It is neutral below 10 min,
   amber from 10 to 19 min and red from 20 min. Total and status are colour-highlighted (status «Новый» vs
   «Собирается»). The badge updates without a page reload.
6. The pharmacy screen renders no client name, phone, address, landmark, client total, profit or
   creator, even when the API response contains them (checked by the test in criterion 7 or by a code review of the component).
7. `npm run lint`, `npm run build`, `node --test` (tests/) and
   `python -m unittest discover backend/tests` pass.

## Tests
- `backend/tests/test_staff_accounts.py` (extend):
  - Default policy row: `base_unit_price`, `base_line_total`, `base_total`, `waiting_since` and `awaiting_response` are present.
    Identity, address and client-finance keys are absent.
  - Pending gives `awaiting_response` true; confirmed gives false.
  - Policy with `item_base_total=False`, `base_total=False` removes the price keys.
  - Handler test: a session for account 2 calls `list_pharmacy_preparation_orders({}, 2)`. The SQL keeps
    `COALESCE(o.fulfillment_pharmacy_id, 1) = %s` with arg 2. A `pharmacy_id`/`account_id` query param gives `VALIDATION_ERROR`.
- `backend/tests/test_order_notification_settings.py` (or the existing settings test): pharmacy_web
  defaults include `item_base_total` and `base_total` and exclude `customer_name`, `phone`, `address`, `landmark`.
- `tests/pharmacy-order.test.ts` (new): `waitingMinutes` (floors, never negative, handles offset-less
  timestamps via `parseOrderTime`), `waitingLevel` thresholds 9/10/19/20.

## Risks
- **Lambda deploy required.** The response and default-policy changes take effect only after
  `admin-api-v1.zip` is deployed to the admin Lambda (`pharmacy-heartbeat-handler`). Deploying is not
  part of this job. The Next.js page must tolerate the old Lambda response (missing
  `waiting_since`/`base_unit_price`): no badge, prices hidden, no crash. The approver should escalate the deploy order to the owner.
- **No migration.** Nothing touches `db/migrations`. Per-item pharmacy assignment would need one and is deferred.
- **Policy change.** Turning on base prices for pharmacy_web by default changes what pharmacy staff
  see. This follows the owner's request and matches the pharmacy Telegram default. It has no effect if the owner has already
  saved explicit settings, so the owner may need to enable "Аптека 1 · веб-панель → суммы" in admin. Hiding identity fields in the UI
  regardless of policy means an admin toggle for pharmacy_web phone/address no longer shows on this
  screen. This is intended by the privacy rule, but the approver should confirm it.
- **Pharmacy 2 sees nothing** until orders are assigned to it. Website orders go to pharmacy 1 and courier
  orders are excluded by policy. This is expected behaviour, not a bug. Changing it is a separate owner decision.
- **Authorization** stays in Lambda (`staff_accounts.session_account` plus `account_id` from the session).
  `src/proxy.ts` and the UI are not trusted.
- **Money** comes from SQL decimals as strings. The UI must not recompute line sums or totals in JS floats.
- **Windows 7 agent:** not affected. `backend/local-agent/agent.py` must not change.
- **Russian copy:** all new labels are in Russian. No client-facing status text changes.

# 013-ordering-flow-v2: customer stages «Собирается → Собран → Подтверждён», admin sees checklist and assembly, «Ватан 1» row actions, alerts until «Сборка сделана», Telegram on price change / «Ватан 2»

## Owner request (verbatim)
Source: `factory/requests/2026-10-19-ordering-flow.md`.

> listen the ordering here what to need to do and how , first of all the check box of the courier i should see as admin, order that goes to vatan_1 the list of medicines the button В наличии should be in that table , also vatan_1 if they want to change the price they also need to make in that table if there no that medicine there and it sended to vatan_2 it should be vatan_2 and about notification notification should be coming till the pharmacy not press button collected and if vatan_1 press button collected it nothing happend in status of the order in courier or admin or client , also if the price is changed or there is no in vatan_1 and it sended to vatan_2 it also shold come notififcation to me and courier, also sound like i installed this web-site staff/login : vatan_1  as app in win 11 but when they closed it there no any notification and make the notification sound 10 second long that they understand that there a new order

Ответы владельца на уточнения (2026-10-19), дословно:

> - «Сборка сделана» должна менять статус заказа.
> - Уведомления владельцу и курьеру об изменении цены / передаче во «Ватан 2»: «И то, и другое» — Telegram сейчас, push — когда будет Web Push.
> - Про статусы (дословно): «listen maybe remove some status but look to my idea when new order comes it should be firstly collected by pharmacy and marked as collected if it collected then we can go on , after collecting we call to customer ask for money say about price of the delivery when we deliver if it is accually the medincines are collected, so accoring this idea need to make status what idea you have»
> - Владелец ответил «да» на предложенную схему:
>   1. Заказ пришёл, аптеки собирают → клиент видит «Собирается» (DB: pending, сборка не завершена).
>   2. Все аптеки нажали «Сборка сделана» → автоматически «Собран» (DB: pending + все аптеки собрали; вычисляется из отметок, без новой колонки статуса).
>   3. Курьер позвонил (сумма лекарств и доставки, оплата, время) и нажал «Согласовано» → «Подтверждён» (DB: confirmed).
>   4. «В пути» (DB: delivering). 5. «Доставлен» (DB: delivered).
>   Статус «В обработке» для клиента убирается. Миграция статусов не нужна.
> - План: задача 013 = админ видит чек-лист курьера и отметки сборки; «Ватан 1» — «В наличии»/«Нет в наличии»/изменение цены прямо в таблице лекарств, ушедшие позиции видны как «Ватан 2»; напоминания аптеке до «Сборка сделана», звук ~10 секунд; новые статусы (выше) у клиента, курьера и админа; Telegram владельцу и курьеру об изменении цены и передаче во «Ватан 2». Задача 014 = Web Push только для /staff (установленное приложение, включая Windows 11), уведомления при закрытом приложении аптекам, владельцу и курьеру.

This job is «задача 013». Web Push / notifications while the installed app is closed (Windows 11 PWA) is
job 014 and out of scope. Builds on jobs 008, 010 (0024), 011 + rework 1 (0025: assembly while `pending`,
per-item «Собрано», «Согласовано» gated on assembly), 012 (pharmacy alerts) and the owner's own commits
029aaa7, 6bae776 (0026 quantity tenths, «Ватан 1» one-minute alarm) and 66b9bfe, all on `main`.

## Goal
Today the customer's `/tracking` shows «В обработке → Сборка → В пути → Доставлен», and nobody outside the
pharmacy sees that «Сборка сделана» happened. The admin cannot see the courier checklist or the assembly
marks. «Ватан 1» answers through a separate form under the table and cannot change a price. Alerts stop
at the first reaction. Nobody is told when a price changes or an item goes to «Ватан 2». After this job:
- Customer, courier and admin all see the same five stages: «Собирается» → «Собран» → «Подтверждён» →
  «В пути» → «Доставлен». «Собран» comes automatically from the pharmacies' marks and is computed in
  Lambda. There is no new status column.
- The admin order card shows the courier checklist and each pharmacy's answers and assembly marks
  (read-only).
- «Ватан 1» works inside the medicines table: «В наличии», «Нет в наличии» (the row stays, marked
  «Ватан 2») and a price change.
- A pharmacy keeps getting alerts until it presses «Сборка сделана». Each alert plays a 10-second sound.
- The owner and the courier get a Telegram message when a pharmacy changes a price or an item goes to
  «Ватан 2».

### Interpretation (decisions pinned by this spec)
- **Stage (derived, not stored).** `stage` is one of `assembling | assembled | confirmed | delivering |
  delivered | cancelled`. It is computed in Lambda from `orders.status` and the 011 marks:
  - status `pending` gives `assembled` only when all of these hold:
    - it is a website order (`created_by_staff_account_id IS NULL`);
    - it has at least one *assembly pharmacy*, with the same rule as `_ORDER_ASSEMBLY_PARTS_SQL`: the
      distinct effective pharmacy of the items whose current pharmacy did not answer `unavailable`;
    - every assembly pharmacy has `order_pharmacy_assembly.state = 'assembled'`.

    In every other case (staff-created orders, orders with nothing to assemble, orders before 011),
    `pending` gives `assembling`.
  - Every other status maps one-to-one to the stage of the same name.

  One implementation lives in a new `backend/v1/shared/order_stage.py`: an SQL fragment or LATERAL that
  takes the order alias, plus a Python mapper. The public and admin Lambdas both use it. The client never
  sends a stage. `orders.status`, `order_status_history` and the transitions are unchanged.
- **Labels** (one table in a new `src/lib/order-stage.ts`): «Собирается», «Собран», «Подтверждён»,
  «В пути», «Доставлен», «Отменён». When `stage` is missing (old Lambda), fall back to `status`:
  `pending` gives «Собирается» and `confirmed` gives «Подтверждён». «В обработке», and «Собирается» for
  `confirmed`, disappear everywhere.
- **Alerts until «Сборка сделана»** (replaces 012's "first reaction"). For pharmacy N, `needs_attention`
  is true while all of these hold:
  - the order is in N's queue (`pending`/`confirmed`, live website order);
  - N has at least one assemblable item;
  - N's part mark is not `assembled`.

  For «Ватан 2» the part becomes `assembled` through per-item «Собрано» (`_sync_item_assembly`).
  `attention_since` is `created_at`. For an order where every item of N was routed to N, it is the
  earliest `pharmacy_assigned_at` of those items. Answers, «Начать сборку» and routing no longer stop the
  alerts.
- **Final sound and interval** (reconciles 6bae776). `PHARMACY_ALARM_SECONDS = 10`. The alarm is a
  ~10-second chime sequence, ending within 10 s, and both pharmacies play it on each due alert. It
  replaces the one-minute alarm for «Ватан 1» and the short chime for «Ватан 2». Repeat intervals stay
  as the owner set them: «Ватан 1» every 60 s (`PHARMACY_ONE_REMIND_MS`) and «Ватан 2» every 180 s
  (`REMIND_MS`). A new due alert stops the previous alarm instead of stacking on it. The alarm stops at
  once when no order needs attention, or when sound is turned off. Courier and admin `NewOrderAlerts` do
  not change.
- **«Ватан 1» row actions.** In the medicines table, each own row of a `pending` order has these
  controls:
  - «В наличии»: answer `available`;
  - «Нет в наличии»: answer `unavailable`, which routes the item to «Ватан 2» as in 010;
  - «Изменить цену»: an input for the pharmacy (base) price plus «Сохранить», sent as `available` with
    `base_unit_price`.

  Routed rows stay in the same table, in `order_item_id` order, built from `routed_away`. They are
  read-only and carry a chip:
  - orange «Ватан 2» while waiting or available there;
  - red «Нет в наличии в обеих аптеках».

  The separate «Передано в Ватан 2» list and `PharmacyAnswerForm` are removed from the «Ватан 1» card.
  The UI no longer offers «Цена отличается». Lambda still accepts `price_differs`, and existing answers
  still show their chip. «Начать сборку» / «Сборка сделана» stay as they are. «Ватан 2»'s per-item
  controls (`PharmacyRoutedItems`) stay. The new row control should reuse them. The price field follows
  the existing «Ватан 2» behaviour when the policy hides the base price.
- **Price change by «Ватан 1».** Remove the 403 «Цену при сборке меняет только «Ватан 2»». Both
  pharmacies then use the same `_reprice_items_from_base` path: they send the base price only, the
  selling price is `vatan_selling_unit_price`, the line and order totals are recomputed in SQL, and one
  `pharmacy.order.item_price_changed` audit row is written. Price changes stay limited to `pending`
  orders and to the item's current pharmacy.
- **Telegram on change.** One `answer_pharmacy_order_items` request can change prices or route items.
  When it does, Lambda adds `_notification` to the response with these fields:
  - `notification_kind: "pharmacy_item_change"`;
  - `admin_order_id`, `order_id` (public id) and `order_reference`;
  - `pharmacy_id`;
  - `event_key = "order:{db_id}:pharmacy-change:{request_id}"`;
  - `changes`: a list of `{kind: "price" | "routed", medicine_name, quantity, old/new base_unit_price,
    old/new selling_unit_price}` (prices only for `price`).

  The payload carries no customer name, phone, address, landmark or comment. The Next.js
  `pharmacy-answers` route removes `_notification` before it answers the browser. It then calls the
  existing `sendOrderNotification` inside try/catch, so a failure is only logged and the answer still
  succeeds. In the notifier, a new branch handles this kind:
  - it claims `owner_telegram` and `courier_telegram` (never `pharmacy_telegram`) through the existing
    claim endpoint;
  - the claim regex accepts the new key; `courier_enabled` / `courier_enabled_since` apply as today;
  - it sends a fixed Russian message, for example:
    > «Заказ № {ref} · Ватан 1: «{name}» × {qty} — передано в Ватан 2»
    > «… — цена изменена: {old} → {new} с.»

    Base prices appear only when the claimed policy has `item_base_total` on (the owner by default).
    Client prices appear only when `item_client_total` is on;
  - the owner message gets the admin link (`ADMIN_ORDER_BASE_URL`), and the courier message gets only
    «📦 Открыть заказ», with no call button.

  This needs no new env var, no new secret and no migration: the claim table key is `VARCHAR(100)`, and
  both recipients are already allowed.

## Scope
- **Backend:**
  - `backend/v1/shared/order_stage.py` (new);
  - `backend/v1/public_api/lambda_function.py`: `track_orders` adds `stage` per order with one extra
    set-based query or LATERAL for the ≤ 20 orders, no N+1. `_order_response` takes an optional stage,
    and `create_order` returns `assembling`;
  - `backend/v1/admin_api/lambda_function.py`:
    - `stage` in `list_orders`, `get_order`, `_courier_order_row`, and on the pharmacy queue's `status`
      field;
    - `get_order` adds a read-only `fulfillment` block from `_COURIER_ORDER_SELECT` / `_courier_order_row`
      for that order: `checklist_steps`, `assembly`, `assembly_complete`, `pharmacy_answers_complete`,
      `confirmed_total`, `unavailable_count`, and per item `pharmacy_id` + `answers`;
    - the new `needs_attention` / `attention_since`;
    - «Ватан 1» repricing;
    - `_notification` on the answer path;
    - the claim regex.
  - `backend/v1/telegram_notifier/lambda_function.py`: the `pharmacy_item_change` branch and its formatter.
- **Frontend:**
  - new: `src/lib/order-stage.ts`;
  - `src/app/tracking/page.tsx` (5-step stepper) and `src/lib/api-v1/types.ts` (`stage?` on `PublicOrder`);
  - admin: `src/app/admin/orders/ui.ts`, `OrderList.tsx`, `page.tsx` (filter labels: `pending`
    «Собираются / собраны», `confirmed` «Подтверждённые»), `[order_id]/page.tsx`, and a new read-only
    `[order_id]/OrderFulfillment.tsx` that reuses `courier-checklist.ts`, `pharmacy-answers.ts` and
    `pharmacy-assembly.ts`;
  - `src/lib/api-v1/admin-types.ts`;
  - staff:
    - `src/app/staff/orders/status.ts`, `CourierOrderList.tsx`, `[order_id]/CourierOrderDetail.tsx`;
    - `PharmacyOrderCard.tsx` (the confirmed chip shows «Подтверждён»);
    - a new row-actions component replacing `PharmacyAnswerForm.tsx` on the «Ватан 1» card;
    - `src/lib/pharmacy-order.ts`, `src/lib/pharmacy-answers.ts`, `staff.css`;
  - alerts: `src/lib/pharmacy-alarm.ts`, `src/lib/pharmacy-alerts.ts` (copy «Ждёт сборки N мин», banner
    «Заказов ждут «Сборка сделана»: N»), `src/components/PharmacyOrderAlerts.tsx`;
  - `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts` (forward `_notification`).
- **Docs:** `API_CONTRACT.md` (§7 tracking `stage`; §8.1 admin `stage` + `fulfillment`; §8.1.2/§8.1.2a:
  stages, row actions, «Ватан 1» price, `needs_attention`, change notification) and
  `docs/PROJECT_CONTEXT.md` §5 (the notifier now also sends change messages).
- **Out of scope:**
  - Web Push, service worker, manifest, VAPID and closed-app notifications (job 014);
  - any migration;
  - new order statuses or changes to status transitions;
  - the «Согласовано» gate logic;
  - admin edit tools;
  - the Telegram message on order creation;
  - notifying «Ватан 2» by Telegram;
  - `backend/local-agent/agent.py`;
  - API Gateway: the existing `/v1/staff/{proxy+}`, `/v1/public/orders/track` and
    `/v1/internal/order-notifications` routes cover everything;
  - applied migrations 0001–0026.

## Acceptance criteria
1. **Stage in the public API.** `POST /v1/public/orders/track` returns `stage` for each order next to
   the unchanged `status`, and the shared rule computes it in SQL. Cases:
   - `pending` with no marks gives `assembling`;
   - `pending` with a single pharmacy `assembled` gives `assembled`;
   - a routed 1→2 order with only «Ватан 1» `assembled` gives `assembling`, and with both gives
     `assembled`;
   - a `pending` order where every item is unavailable in both pharmacies gives `assembling`;
   - a staff-created `pending` order gives `assembling`;
   - `confirmed`, `delivering`, `delivered` and `cancelled` map 1:1.

   The request still accepts only `{phone}`. There are no new writes and no N+1 queries: the query count
   is fixed whatever the number of orders.
2. **Stage labels everywhere.** `/tracking` shows the stepper «Собирается · Собран · Подтверждён · В пути
   · Доставлен», and «Заказ отменён» is unchanged. The admin list and detail, and the courier list and
   detail, show the label of `stage`. `orderStageLabel` in `src/lib/order-stage.ts` covers every stage
   and the fallback when `stage` is missing. `rg "В обработке" src` finds nothing. `confirmed` is labelled
   «Подтверждён», not «Собирается», in `ui.ts` and `status.ts`.
3. **Admin order card (read-only).** `GET /v1/admin/orders/{id}` returns `fulfillment`, as defined in
   Scope. It is `null` for non-website orders, and adds at most one query. `/admin/orders/[id]` renders:
   - the 7 checklist steps with done marks;
   - «Ватан N: собран / собирается / ждёт сборки»;
   - each item's pharmacy and answer label (orange «В аптеке 2», red «Нет в наличии в обеих аптеках»);
   - «Подтверждённая сумма» or «Сумма ещё не подтверждена аптекой».

   There are no buttons or inputs in this block. With an old Lambda (no `fulfillment`), the block is
   hidden and nothing crashes.
4. **«Ватан 1» row actions.** On a `pending` «Ватан 1» card, every own row has «В наличии»,
   «Нет в наличии» and «Изменить цену» → «Сохранить». They `POST` the existing `pharmacy-answers` payload
   (an item id, an answer, and optionally `base_unit_price`) and call `router.refresh()`. A row answered
   «Нет в наличии» stays in the table after the refresh, read-only, with an orange «Ватан 2» chip, or red
   when «Ватан 2» also lacks it. There is no separate «Передано в Ватан 2» list and no
   `PharmacyAnswerForm` on that card. A 403/409 shows the Lambda's Russian message. With an old Lambda
   (no `order_item_id`), no controls are rendered.
5. **«Ватан 1» price change (Lambda).**
   - Pharmacy 1 sending `{answer: "available", base_unit_price}` for its own item of a `pending` order
     goes through `_reprice_items_from_base`:
     - the SQL sets the selling price with `vatan_selling_unit_price` and recomputes the line and order
       totals;
     - it writes exactly one `pharmacy.order.item_price_changed` audit row with `staff:1` and no PII.
   - The request is rejected (400/403/409), with nothing written, when:
     - the price is out of range or has more than 2 decimals;
     - the price comes with `unavailable`;
     - the item belongs to the other pharmacy;
     - the status is not `pending`.
   - Repeating the same price writes nothing and produces no `_notification`.
6. **Alerts until «Сборка сделана».** `needs_attention` follows the Interpretation:
   - it stays true after answers and after «Начать сборку»;
   - it becomes false only at `assembled`, or when N has nothing to assemble;
   - for «Ватан 2» it becomes false when the last routed item is «Собрано».

   `PHARMACY_ALARM_SECONDS === 10`, and every scheduled oscillator stops within 10 s of the start. Both
   pharmacies use the alarm. `dueAlerts` intervals are 60 s for pharmacy 1 and 180 s for pharmacy 2. The
   alarm stops when the attention count reaches 0. The toast and banner text say «Ждёт сборки» and
   contain no client data. Courier `NewOrderAlerts` does not change.
7. **Telegram on price change / routing.**
   - An answer request that routes an item or changes a price returns `_notification`, as defined in
     the Interpretation, with no `customer_name`, `phone`, `address`, `landmark` or `notes` keys.
   - A request with only `available`/`price_differs` and no price change returns none.
   - The Next.js route never sends `_notification` to the browser, and a notifier failure still returns
     the answer with 200.
   - The claim endpoint accepts `order:N:pharmacy-change:<request-id>` for `owner_telegram` and
     `courier_telegram`. It rejects `pharmacy_telegram` with this key, and any malformed key, with 400.
   - The notifier sends one owner message and, if claimed, one courier message. It sends no pharmacy
     message and no picking list. The text has the reference, the pharmacy, the medicine, the quantity,
     and either «передано в Ватан 2» or «цена изменена: old → new». The courier text has no base price
     under the default policy.
   - A second claim of the same key sends nothing.
8. **Gates:** `npm run lint`, `npm run build`, `npm run test:frontend` and
   `python -m unittest discover -s backend/tests -t .` pass, apart from the 2 failures already known on
   `main`.

## Tests
- `backend/tests/test_order_stage.py` (new): the shared mapper for every status and assembly combination
  in AC1.
- `backend/tests/test_public_order_create.py`, or a new `test_public_tracking.py`: `track_orders` returns
  `stage`, with a fixed query count (mocked cursor). `create_order` returns `assembling`.
- `backend/tests/test_courier_orders.py` (extend): `stage` on courier rows. Add an admin `get_order` test
  (new or in `test_admin_contract.py`) for `fulfillment`, including `null` for staff orders.
- `backend/tests/test_pharmacy_answers.py` (extend):
  - «Ватан 1» repricing (SQL and args, audit shape) and every rejection case in AC5;
  - the `_notification` shape for routing, price and mixed requests, with no PII keys;
  - none on a repeat;
  - none for a plain `available`.
- `backend/tests/test_staff_accounts.py` (extend): the new `needs_attention` for:
  - an unreacted order;
  - an answered order;
  - an order at `assembling`;
  - an order at `assembled`;
  - a «Ватан 2» order with partly or fully collected items;
  - a pharmacy whose items are all unavailable.

  Also check `attention_since`.
- `backend/tests/test_order_notification_settings.py` (extend): the claim regex accepts and rejects
  keys as in AC7.
- `backend/tests/test_telegram_notifier.py` (extend): the `pharmacy_item_change` branch, covering the
  recipients, the text, the policy-gated prices, the buttons and an unclaimed recipient (with stubbed
  claim and send).
- `tests/order-stage.test.ts` (new; add to `test:frontend`): labels, fallback, and the tracking step
  index.
- `tests/pharmacy-alarm.test.ts` (update): 10 s and the bounded stop times.
- `tests/pharmacy-alerts.test.ts` (update): the intervals per pharmacy and the new copy, with no PII.
- `tests/pharmacy-order.test.ts` and `tests/pharmacy-answers.test.ts` (extend): routed rows merged into
  the «Ватан 1» table in item order with orange/red tones; row-action request validation; degrading on an
  old Lambda.

## Risks
- **ESCALATE: three Lambda deploys, no migration.** No new env vars or secrets. The order is:
  1. Admin `pharmacy-heartbeat-handler` (`admin-api-v1.zip`), so the claim accepts the new keys before
     anyone sends them;
  2. notifier `pharmacy-telegram-order-notifier` (`telegram-order-notifier.zip`);
  3. public `pharmacy-query-handler` (`public-api-v1.zip`);
  4. Vercel.

  None of these is part of this job. Without the new public Lambda, `/tracking` falls back to `status`,
  so `pending` shows «Собирается» and «Собран» never appears. With an old notifier, the admin Lambda
  still claims, but the old notifier rejects or mis-formats the kind. The Next.js route only logs this.
  The two must still be deployed together.
- **ESCALATE: owner's concurrent commits ride along.** A build from `main` packages 6bae776's
  `shared/contract.py` (quantities from 0.1, two decimals) into both the admin and public Lambdas.
  Migration 0026 is not recorded as applied (the last recorded is 0025 on 2026-10-17). Confirm 0026 is
  live before deploying either Lambda. Otherwise a 0.1–0.49 quantity hits the old CHECK and returns a
  500. This job adds no migration, and the next free number stays 0027.
- **Behaviour changes the owner should know:**
  - Alerts now continue after the pharmacy answers or presses «Начать сборку». They stop only at
    «Сборка сделана».
  - Older `confirmed` orders that never got «Сборка сделана», for example ones the admin confirmed,
    will start alerting until marked.
  - «Ватан 1» loses the «Цена отличается» button.
  - «Ватан 1» can now change prices, which changes the client total before the courier's call. It is
    audited and announced in Telegram.
- **Public API surface.** `stage` reveals only a progress step for the caller's own phone. It is not
  client-trusted and adds no PII. Tracking rate limits are unchanged.
- **Telegram content and privacy.** The message carries no client identity. The courier claim respects
  `courier_enabled`. Delivery is at-most-once, as in 0021: a failed send is not retried. The payload
  travels from Lambda through the Next.js server to the notifier, the same as at checkout, and never
  reaches the browser. «Ватан 2» answering «нет в наличии» (unavailable in both) does not notify, because
  it was not requested; this is a possible follow-up.
- **Sound.** Browser autoplay rules still need the existing tap-to-enable. The 10-second alarm plays only
  while the page is open. Closed-app alerts, including the installed Windows 11 app, are job 014.
- **Boundary:** all SQL stays in Lambda. Next.js only proxies, and no stage, price total or role is taken
  from the client.
- **Windows 7 agent:** not affected. `backend/local-agent/agent.py` must not change.
- **Russian copy:** all new labels and messages are in Russian, with the names «Ватан 1» / «Ватан 2».
  The customer-facing `/tracking` wording changes as listed in AC2.

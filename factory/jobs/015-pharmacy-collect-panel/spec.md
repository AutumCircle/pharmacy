# 015-pharmacy-collect-panel: one assembly panel for «Ватан 1» and «Ватан 2» — only «Нет в наличии» and tap-to-edit price per item, one «Собран» button, Telegram to the courier saying where the order lies

## Owner request (verbatim)
Source: `factory/requests/2026-10-20-pharmacy-panel-order-view.md` (voice input, 2026-10-20). This job is part «015» of the orchestrator's split; part «016» (order view and history for admin/courier) is a separate job.

> Вот для двух аптек, как должно выглядеть панель заказа на сборку. Должна быть таблица и у каждого товара кнопка «Нет в наличии». И под ней кнопка «Собран». То есть, когда приходит уведомление «Новый заказ», аптека слышит уведомление о заказе, идет, собирает эти лекарства. Потом, после того, как пришел, если все лекарства на месте и сумма совпадает, она нажимает «Собран». Если сумма не совпадает, она меняет сумму. И если например, нету одного, они указывают «Нет в наличии». А кнопка «В наличии» нам не нужен. И нажимает «Собран». А вообще для второй аптеки панель выглядит вообще по-другому, но эта панель должна выглядеть идентично. То есть Тоже так же. Она может менять сумму и может поставить нет наличий. Если оно в наличии, все они, не нужно по одному, просто нужно нажать собран. И после того, как аптека нажимает кнопку собран, если только эта аптека один, курьеру должно приходить сообщение, что заказ собран, и он лежит в аптеке один, или заказ собран, он лежит в аптеке 2, или вот эти лекарства лежат в аптеке 1, вот это лекарство лежат в аптеке 2. С помощью Telegram-уведомления. Также нужно поправить заказ, вид заказа. Вид заказа вообще когда ты открываешь заказ, чек-лист у меня должен быть виден, информация о клиенте также. Нужно сделать более понятный UX/UI дизайн и для курьера, и для администратора, для просмотра заказа. В большинстве случаев администратор смотрит в десктоп-версии, а курьер в мобильной версии. Например, товары и у курьера, и у администратора в панели заказ, когда ты заходишь, там есть список товаров. И например, в панели администратора когда должен вот эти в панели товары выходить, вот эти подтвержденные суммы товары, что изменилось, где изменилось, в истории у каждого заказа это логи. Этой задачи, и там должны появляться все, что происходило с заказом. Какие еще идеи есть?

Orchestrator's split (part 015):
> 015 — панель сборки аптеки (обе аптеки одинаково): таблица; у каждого товара только «Нет в наличии» и изменение цены (кнопки «В наличии» нет — всё, что не отмечено, считается в наличии); одна кнопка «Собран» под таблицей; после «Собран» — Telegram курьеру: где лежит заказ (Ватан 1 / Ватан 2 / какие лекарства где).

## Interpretation (owner can correct)
1. **One panel, the same for both pharmacies.** Both use the existing table (`PharmacyOrderCard` + `PharmacyItemRow`). Each own row of a «Новый» (`pending`) order that is not yet «Собран» has exactly two controls:
   - **«Нет в наличии»**, with the existing inline confirmation. At «Ватан 1» it passes the item to «Ватан 2», as today. At «Ватан 2» it means «нет в наличии в обеих аптеках».
   - **Tap the price to edit it.** This is unchanged: it sends `available` + `base_unit_price`.

   The «В наличии» button is removed. An item not marked «Нет в наличии» counts as available.

   The per-item «Собрано» button at «Ватан 2» is removed too. Items already marked «Собрано» keep their chip.
2. **One «Собран» button under the table.** It replaces «Начать сборку», «Сборка сделана» and the per-item «Собрано», for both pharmacies. This includes «Ватан 2» when all of its items were routed to it.
   - **«Начать сборку» does not survive.** The owner's flow (alert → collect → fix prices or mark missing → «Собран») has no "start" step. The alarm already runs until «Собран».
   - One tap, with no extra confirmation. The owner asked for speed.
   - The Lambda allows the direct `none → assembled` transition. The existing `assembled` path already records «В наличии» for this pharmacy's still unanswered items, so «not marked = available» is enforced on the server.
   - The `assembling` state is still accepted for compatibility with old clients. The «Собирается» chip may still appear, for example after the job 014 reopen.
3. **After «Собран» the panel is read-only for that pharmacy.** This keeps the courier message true.
   - The UI hides the row controls once `assembly_state === 'assembled'`.
   - The Lambda rejects a later `pharmacy-answers` from that pharmacy with 409 `ASSEMBLY_STATE_CONFLICT` «Заказ уже отмечен «Собран»», and writes nothing.
   - If «Ватан 1» later routes an item to «Ватан 2», the job 014 reopen sets «Ватан 2» back to «Собирается». «Ватан 2» then gets its controls and alert again.
   - There is no pharmacy undo. A mis-tap is corrected by the owner, as in 011.
4. **Telegram «Заказ собран».** The message goes to the courier, and to the owner as well. Both are already allowed recipients of the job 013 change messages.
   - **When it is sent:** only when the whole order's assembly becomes complete, meaning every assembly pharmacy is `assembled`. It is triggered by the «Собран» that completes it.
   - **No per-pharmacy message.** A partial «Ватан 1 собрал, ждём Ватан 2» message is not sent. The courier sees partial marks in the panel. The owner can ask for one.
   - Text, built only from the medicine name and quantity per pharmacy:
     - one pharmacy: «✅ Заказ № {ref} собран, лежит в Ватан 1» (or «… в Ватан 2»);
     - split: «✅ Заказ № {ref} собран» followed by «В Ватан 1: «A» × 1, «B» × 2» and «В Ватан 2: «C» × 1»;
     - if any item is missing in both pharmacies: «Нет в наличии: «D» × 1»;
     - the order total line «Сумма: N с.» appears only when the claimed policy has `client_total` on.
   - The message never contains the client's name, phone, address, landmark or comment.
   - The courier message gets only «📦 Открыть заказ». The owner message gets the admin link.
   - If assembly is reopened and completed again, a new message is sent: the event key is per request.

## Goal
Pharmacists at «Ватан 1» and «Ватан 2» get the same short panel:
- they collect the order;
- they correct a price by tapping it, or mark a missing item «Нет в наличии»;
- they press one «Собран».

Everything not marked counts as available. The pharmacy's alerts stop, the order moves to the «Собран» stage, and the courier's «Согласовано» unblocks as today. As soon as the whole order is assembled, the courier (and the owner) get one Telegram message saying where the order lies: «Ватан 1», «Ватан 2», or which medicines are in which pharmacy.

## Scope
- **Backend: `backend/v1/admin_api/lambda_function.py`**
  - `_ASSEMBLY_TRANSITIONS` adds `(None, "assembled")`.
  - `mark_pharmacy_assembly` changes:
    - when the target is `assembled` and the order's assembly is now complete (`_ORDER_ASSEMBLY_PARTS_SQL`, in the same transaction), the response carries `_notification` with:
      - `notification_kind: "pharmacy_order_assembled"`;
      - `admin_order_id`, `order_id`, `order_reference`, `pharmacy_id`;
      - `event_key = "order:{db_id}:assembled:{request_id}"`;
      - `parts: [{pharmacy_id, items: [{medicine_name, quantity}]}]`;
      - `missing: [{medicine_name, quantity}]`;
      - `client_total`.
    - The audit is unchanged (`pharmacy.order.assembly_marked`).
  - `answer_pharmacy_order_items` returns 409 when the session pharmacy's part is `assembled`, under the existing order lock.
  - `claim_order_notification`: the regex accepts `assembled:req_[0-9a-f]{32}`. It is allowed only for `owner_telegram` and `courier_telegram`.
- **Backend: `backend/v1/telegram_notifier/lambda_function.py`**
  - a new branch for `pharmacy_order_assembled` with an event-key check and `format_order_assembled_message(event, fields)`;
  - it claims owner and courier through the existing claim endpoint and never the pharmacy.
- **Frontend: Next.js routes and libs**
  - `src/app/api/staff/orders/[order_id]/assembly/route.ts`: strip `_notification` with `splitChangeNotification` and send it in `after()` through `sendChangeNotificationSafely`, the same as `pharmacy-answers/route.ts`.
  - `src/lib/pharmacy-assembly.ts`: `nextAssemblyAction` returns only `{state: 'assembled', label: 'Собран'}` or null.
  - `src/lib/pharmacy-order.ts`: no `available` action; `canCollect` is always false; controls are hidden when the part is `assembled`; `partControls` is shown for «Ватан 2» too.
  - `src/lib/pharmacy-answers.ts`: labels. The `available` request remains only for the price edit.
- **Frontend: staff UI**
  - `src/app/staff/orders/PharmacyItemRow.tsx`, `PharmacyAssemblyButtons.tsx` (one «Собран» button plus the chip), `PharmacyOrderCard.tsx`, `staff.css`.
  - `src/lib/api-v1/staff-types.ts` if the types change.
- **Docs**
  - `API_CONTRACT.md` §8.1.2a: the flow, the `none → assembled` transition, the 409 after «Собран», and the new notification kind and claim key.
  - `docs/PROJECT_CONTEXT.md` §5: one new item, «Job 015».
- **Out of scope:**
  - the admin order screen, the courier order detail and list, and the order history (job 016, running in parallel; do not edit `src/app/admin/orders/*`, `CourierOrderDetail.tsx` or `CourierOrderList.tsx`);
  - alarms and `PharmacyOrderAlerts`, since `needs_attention` already ends at `assembled`;
  - the order stage and status rules, and `_require_assembly_complete`;
  - the Telegram message on order creation;
  - removing the `assembly/items` endpoint (it stays in Lambda, unused by the UI);
  - any migration, `backend/local-agent/*`, and deploys.

## Acceptance criteria
1. **Panel (both pharmacies).** For pharmacy id 1 and 2, `pharmacyOrderView` gives own pending rows exactly two controls: «Нет в наличии» (with confirmation) and the price editor, shown when the policy shows prices.
   - No row has «В наличии» or «Собрано»: `rg "ROW_ACTION_LABELS.available|ROW_ACTION_LABELS.collect" src/app/staff` finds nothing.
   - Routed-away rows of «Ватан 1» stay read-only with their chip.
   - When `assembly_state === 'assembled'`, no row has controls.
2. **One «Собран».** When `assembly_available` is true and the part is not `assembled`, the card footer shows one «Собран» button for both pharmacies, including a «Ватан 2» whose every item was routed to it.
   - The button POSTs `{state: 'assembled'}` to the existing `assembly` route.
   - «Начать сборку» and «Сборка сделана» appear nowhere in `src/app/staff`.
   - After success the chip reads «Собран».
   - On an old Lambda response (no `assembly_available`), no button is shown and nothing crashes.
3. **Lambda «Собран».** `none → assembled` succeeds on a `pending` order:
   - it writes one upsert;
   - it answers «В наличии» for the pharmacy's unanswered items;
   - it writes one `pharmacy.order.assembly_marked` audit row with `from_state: null`;
   - it never touches `orders.status`.

   `assembling → assembled` still works. A repeat is a no-op, with no writes and no `_notification`. The pharmacy id comes only from the session. Courier sessions get 403.
4. **Read-only after «Собран».** `pharmacy-answers` from a pharmacy whose part is `assembled` returns 409 `ASSEMBLY_STATE_CONFLICT` and writes nothing. After the job 014 reopen of «Ватан 2», `pharmacy-answers` from «Ватан 2» works again.
5. **Notification payload.** `_notification` is present only when this request completes the order's assembly.
   - A single-pharmacy order gives one part.
   - A routed order gives the parts for «Ватан 1» and «Ватан 2» with their items, plus `missing` for items unavailable in both.
   - When the first of two pharmacies presses «Собран», there is no notification.
   - The payload has no `customer_name`, `phone`, `address`, `landmark` or `notes` keys.
   - The Next.js `assembly` route never returns `_notification` to the browser. A notifier failure is only logged, and the route still returns 200.
6. **Claim and notifier.**
   - The claim accepts `order:N:assembled:req_<32 hex>` for `owner_telegram` and `courier_telegram`. It rejects that key for `pharmacy_telegram`, and any malformed key, with 400. A second claim of the same key sends nothing.
   - The notifier sends one owner message and, if claimed, one courier message, with the texts from Interpretation 4:
     - «лежит в Ватан 1»;
     - «лежит в Ватан 2»;
     - the split lists;
     - «Нет в наличии: …».
   - The «Сумма» line appears only when `client_total` is on.
   - The courier message has only the «📦 Открыть заказ» button.
7. **Gates.** These pass, apart from the failures already known on `main`:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`
   - `npm run test:frontend`
   - `python -m unittest discover -s backend/tests -t .`

## Tests
- `backend/tests/test_pharmacy_assembly.py` (extend):
  - `none → assembled` (SQL, args, audit, auto-«В наличии»);
  - a repeat is a no-op;
  - the `_notification` shape for a single-pharmacy order, a split order and a partial order (none), and for missing-in-both items;
  - no PII keys in the payload;
  - courier sessions get 403.
- `backend/tests/test_pharmacy_answers.py` (extend): the 409 after «Собран», with no writes; answers allowed again after the reopen.
- `backend/tests/test_order_notification_settings.py` (extend, or wherever the claim regex is tested): the `assembled:req_…` key is accepted or rejected per recipient; malformed keys are rejected.
- `backend/tests/test_telegram_notifier.py` (extend):
  - `format_order_assembled_message` for the 1-, 2- and split-pharmacy cases, the missing line and the `client_total` gating;
  - recipients are owner and courier only, never the pharmacy;
  - the courier button;
  - an unclaimed recipient sends nothing;
  - the event-key mismatch raises.
- `tests/pharmacy-order.test.ts` (extend): the same rows for ids 1 and 2; no `available`/`collect` controls; controls are hidden when the part is `assembled`; `partControls` is true for an all-routed «Ватан 2».
- `tests/pharmacy-assembly.test.ts` (update): `nextAssemblyAction` returns «Собран» for `null` and `assembling`, and null for `assembled` and for a missing `assembly_available`.
- `tests/pharmacy-answers.test.ts` (extend): `splitChangeNotification` strips a `pharmacy_order_assembled` payload, and `rowActionRequest('price')` is unchanged.

## Risks
- **ESCALATE: two Lambda deploys plus Vercel, no migration.** No new env vars or secrets. Nothing is deployed by this job. Deploy in this order:
  1. the admin Lambda, so the claim accepts `assembled:` keys before anyone sends them;
  2. the notifier Lambda;
  3. Vercel.

  With an old notifier, the new kind falls through to the order-creation branch and claims `order:N:created`, which is already taken, so nothing is sent. Still deploy them together.
  With an old admin Lambda and the new UI, «Собран» on an unmarked part returns 409 «Сначала нажмите «Начать сборку»». So the Lambda must go first.
- **Behaviour change for staff.**
  - «В наличии», «Начать сборку» and the per-item «Собрано» disappear.
  - «Собран» is final for the pharmacy.
  - A «Нет в наличии» mis-tap at «Ватан 2» cannot be undone by the pharmacy (there is no «В наличии» button); the owner corrects it.
  - Brief the pharmacists before the release.
- **Parallel job 016.** It redesigns the admin and courier order views and may also edit `API_CONTRACT.md`, `docs/PROJECT_CONTEXT.md` and shared libs (`pharmacy-assembly.ts`, `pharmacy-answers.ts`, `staff-types.ts`).
  - This job changes only the pharmacy-panel functions in those libs, and keeps `courierAssemblyLines`, `confirmBlockedReason` and `assemblyWarning` unchanged.
  - Expect a doc merge conflict.
- **Security and boundary.**
  - Authorization stays in the Lambda: the session pharmacy id, `FOR UPDATE` on the order, and no pharmacy id in the body.
  - Completion is computed in SQL in the same transaction.
  - The notification payload goes from Lambda to Next.js server `after()` to the notifier, and never reaches the browser.
  - There is no client identity in the Telegram text, and the courier claim respects `courier_enabled`.
  - Delivery is at-most-once, as in 0021.
- **Migration:** none. The claim key length, `order:{id}:assembled:req_` plus 32 hex characters, fits the existing `VARCHAR(100)`. The next free migration number stays 0027.
- **Windows 7 agent:** not affected. `backend/local-agent/agent.py` must not change.
- **Russian copy:**
  - «Собран» and «Нет в наличии»;
  - «Заказ уже отмечен «Собран»»;
  - the Telegram texts «Заказ № … собран, лежит в Ватан 1 / Ватан 2», «В Ватан 1: …», «В Ватан 2: …», «Нет в наличии: …» and «Сумма: … с.».

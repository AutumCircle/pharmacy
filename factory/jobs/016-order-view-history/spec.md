# 016-order-view-history: Экран заказа для администратора и курьера + история заказа

## Owner request (verbatim)

Источник: `factory/requests/2026-10-20-pharmacy-panel-order-view.md` (голосовой ввод). Эта задача — часть «016»;
часть про панель сборки аптеки и Telegram курьеру — задача 015.

> Вот для двух аптек, как должно выглядеть панель заказа на сборку. Должна быть таблица и у каждого товара кнопка «Нет в наличии». И под ней кнопка «Собран». То есть, когда приходит уведомление «Новый заказ», аптека слышит уведомление о заказе, идет, собирает эти лекарства. Потом, после того, как пришел, если все лекарства на месте и сумма совпадает, она нажимает «Собран». Если сумма не совпадает, она меняет сумму. И если например, нету одного, они указывают «Нет в наличии». А кнопка «В наличии» нам не нужен. И нажимает «Собран». А вообще для второй аптеки панель выглядит вообще по-другому, но эта панель должна выглядеть идентично. То есть Тоже так же. Она может менять сумму и может поставить нет наличий. Если оно в наличии, все они, не нужно по одному, просто нужно нажать собран. И после того, как аптека нажимает кнопку собран, если только эта аптека один, курьеру должно приходить сообщение, что заказ собран, и он лежит в аптеке один, или заказ собран, он лежит в аптеке 2, или вот эти лекарства лежат в аптеке 1, вот это лекарство лежат в аптеке 2. С помощью Telegram-уведомления. Также нужно поправить заказ, вид заказа. Вид заказа вообще когда ты открываешь заказ, чек-лист у меня должен быть виден, информация о клиенте также. Нужно сделать более понятный UX/UI дизайн и для курьера, и для администратора, для просмотра заказа. В большинстве случаев администратор смотрит в десктоп-версии, а курьер в мобильной версии. Например, товары и у курьера, и у администратора в панели заказ, когда ты заходишь, там есть список товаров. И например, в панели администратора когда должен вот эти в панели товары выходить, вот эти подтвержденные суммы товары, что изменилось, где изменилось, в истории у каждого заказа это логи. Этой задачи, и там должны появляться все, что происходило с заказом. Какие еще идеи есть?

Разбивка оркестратора: «016 — экран заказа для администратора (десктоп) и курьера (мобильный): виден чек-лист,
информация о клиенте, понятный список товаров с подтверждёнными суммами и изменениями (что/где изменилось),
история заказа (лог всех событий).»

## Interpretation

- «Чек-лист у меня должен быть виден, информация о клиенте также» — на странице заказа администратора
  (`/admin/orders/[order_id]`) карточка клиента и чек-лист курьера (блок `OrderFulfillment` из задачи 013) стоят
  первыми в правой колонке и видны без прокрутки на десктопе (≥ 1000 px). Сейчас первой идёт смена статуса,
  клиент — третьим блоком.
- «Подтверждённые суммы, что изменилось, где изменилось» — список товаров администратора становится таблицей:
  товар, аптека (Ватан 1 / Ватан 2, «передано из Ватан 1»), количество, цена клиенту, сумма, ответ аптеки
  (в наличии / нет в наличии / цена изменена с X на Y аптекой N) и пометка последнего изменения. Под таблицей —
  «Сумма заказа» и «Подтверждено аптеками» (`fulfillment.confirmed_total`). Редактирование строки
  (количество, цены, удаление) сохраняется как сейчас.
- «В истории у каждого заказа логи, всё, что происходило с заказом» — блок «История» перестаёт показывать только
  `order_status_history` и становится хронологией из уже существующих источников: `orders.created_at`,
  `order_status_history`, `admin_audit_log` (`resource_type = 'order'` по публичному id заказа и
  `resource_type = 'order_item'` по позициям заказа). В `admin_audit_log` уже пишутся ответы аптек, передача в
  «Ватан 2», изменение цены аптекой, «Собрано» по позиции, «Сборка сделана», переоткрытие сборки, шаги чек-листа
  курьера, правки администратора и курьера (клиент, позиции, цены, доставка), удаление. Новая таблица и миграция
  не нужны.
- История собирается в admin Lambda и встраивается в существующие ответы `GET /v1/admin/orders/{order_id}`
  (полная, поле `timeline`) и `GET /v1/staff/orders/{order_id}` для курьера (короткая), без нового маршрута в API
  Gateway. Lambda отдаёт структурированные события по белому списку полей (без сырого `details`); русский текст
  строится в Next.js чистой функцией.
- Курьер видит короткую историю: создание, смены статуса, ответы аптек и передачу в «Ватан 2», изменение цены
  аптекой, отметки сборки, свои шаги чек-листа, отмену с причиной. Курьер не видит: прежние значения данных
  клиента, долю владельца за доставку, цены аптеки/прибыль, удаление, кто из админов что делал (только
  «Администратор»).
- Курьер (мобильный, `/staff/orders/[order_id]`): порядок блоков — шапка (номер, этап) → клиент (имя, телефон,
  крупная кнопка «Позвонить» `tel:`, адрес, ориентир, комментарий) → товары, сгруппированные по месту получения
  («Забрать в Ватан 1» / «Забрать в Ватан 2», нет в наличии — отдельно), с подтверждённой суммой → чек-лист →
  «Мне за доставку» → короткая история (свёрнута) → закреплённая панель действий. Все существующие действия и
  проверки (409, «Согласовано» ждёт сборку) остаются.
- Панель аптеки (`PharmacyOrderCard` и т. п.) — задача 015, здесь не трогается.

## Goal

Администратор (обычно с десктопа) открывает заказ и сразу видит клиента и чек-лист, понятную таблицу товаров с
подтверждёнными аптеками суммами и тем, что и в какой аптеке изменилось, а также полную хронологию заказа.
Курьер (обычно с телефона) видит компактную карточку: клиент и звонок сверху, где забрать какие лекарства,
подтверждённая сумма, чек-лист и действия — с меньшей прокруткой, плюс короткую историю. Данные истории
собираются только в Lambda параметризованным, ограниченным SQL и не раскрывают лишнего ролям.

## Scope

- Backend (read paths only):
  - New pure module `backend/v1/shared/order_timeline.py`: maps rows from `order_status_history` and
    `admin_audit_log` to whitelisted events `{at, kind, actor, pharmacy_id?, order_item_id?, medicine_name?,
    from_status?, to_status?, answer?, previous_price?, new_price?, step?, done?, reason?, fields?}`; actor is
    one of `customer | admin | courier | pharmacy | system`; unknown actions become `kind: "other"` with no
    details; `courier_view(events)` filters/strips for the courier.
  - `backend/v1/admin_api/lambda_function.py`: `get_order` adds `timeline` (and `timeline_truncated`);
    `get_courier_order` adds the courier `timeline`. Do not add it to `_courier_order_row`/list endpoints or
    to `_admin_fulfillment`. Max 200 newest events, returned oldest→newest; at most 2 extra queries per request.
- Frontend:
  - `src/lib/order-timeline.ts` (new, pure): Russian labels for events, actor labels («Клиент», «Администратор»,
    «Курьер», «Ватан 1», «Ватан 2», «Система»), latest change per `order_item_id` for the items table.
  - `src/lib/api-v1/admin-types.ts`, `src/lib/api-v1/staff-types.ts`: optional `timeline` types.
  - `src/app/admin/orders/[order_id]/page.tsx`, `OrderItems.tsx`, `OrderFulfillment.tsx`,
    `OrderCustomerEditor.tsx` (read mode first, «Изменить» opens the form), new `OrderTimeline.tsx`,
    `src/app/admin/orders/orders-ui.css`.
  - `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx`, `src/app/staff/staff.css`.
- Docs: `API_CONTRACT.md` (new `timeline` fields, courier filtering), `docs/PROJECT_CONTEXT.md` §5 (one line).
- Out of scope: pharmacy panel and its helpers (`PharmacyOrderCard`, `PharmacyItemRow`,
  `PharmacyAssemblyButtons`, `usePharmacyItemPost`, `PharmacyAlertBanner`, semantics of
  `src/lib/pharmacy-answers.ts` / `pharmacy-assembly.ts`), any pharmacy/courier mutation handler, Telegram
  notifier, migrations (`db/migrations`), new API Gateway routes, `backend/local-agent/agent.py`, order list pages.

## Acceptance criteria

1. `GET /v1/admin/orders/{order_id}` returns `timeline`: a creation event, every `order_status_history` row, and
   every `admin_audit_log` row for the order (`resource_type='order'`, `resource_id` = public id or `legacy_N`)
   and its items (`resource_type='order_item'`, by current item ids, plus removed items matched via
   `details.order_id` / `details.order_reference` / `details.reference` within `created_at >= orders.created_at`),
   sorted by time then id, capped at 200 newest with `timeline_truncated`. All SQL is parameterized; no raw
   `details` object reaches the response — only whitelisted keys (unit-tested).
2. `GET /v1/staff/orders/{order_id}` (courier) returns a short `timeline` with only: created, status changes
   (with cancel reason), pharmacy answers/routing, pharmacy price change, assembly marks/reopen, checklist steps.
   It never contains customer field values, `delivery_owner_amount`/owner share, base (pharmacy) prices of admin
   edits, `order.soft_delete`, or admin usernames (unit-tested). `GET /v1/staff/orders` (list) and pharmacy
   endpoints are unchanged.
3. Admin page at ≥ 1000 px: two columns; the right column starts with the client card (name, phone as `tel:`
   link, address, landmark, comment; «Изменить» opens the existing editor) followed by «Курьер и аптеки»
   (checklist + assembly), then status, delivery, deletion. Below 1000 px the order is: client, checklist,
   items, status, history. Existing edit/status/delete behaviour is unchanged.
4. Admin items table shows per row: name, pharmacy («Ватан 1» / «Ватан 2» / «передано из Ватан 1»),
   quantity, client price, line sum, pharmacy answer chip, and the latest change from the timeline (e.g. «Цена
   изменена Ватан 2: 25,00 → 28,00 с.»). Under it: «Сумма заказа» and «Подтверждено аптеками» (or «ждёт
   ответа»). Staff-created orders and an older Lambda without `timeline`/`fulfillment` render without errors.
5. Admin «История» lists the timeline chronologically with time (`formatOrderDateTime`), actor label and Russian
   text for every known kind; unknown kinds show «Изменение заказа»; truncated shows «Показаны последние 200
   событий».
6. Courier card at 375 px: client block with a ≥ 44 px «Позвонить» `tel:` button is the first block after the
   header/progress; items are grouped «Забрать в Ватан 1» / «Забрать в Ватан 2» / «Нет в наличии» with the
   confirmed sum; then checklist, fee, collapsed «История» (`<details>`), sticky action bar. All existing
   courier actions (checklist toggles, status, cancel, customer/item edits, fee) still work.
7. `npm run lint`, `npm run build`, `node --test` for the new/changed tests and
   `python -m unittest discover backend/tests` pass.

## Tests

- `backend/tests/test_order_timeline.py` (new): mapping of each known action (`pharmacy.order.items_answered`
  incl. `routed_to_pharmacy_2`, `pharmacy.order.item_price_changed`, `pharmacy.order.item_collected`,
  `pharmacy.order.assembly_marked`, `pharmacy.order.assembly_reopened`, `courier.order.checklist_updated`,
  `courier.order.status_changed`, `order.customer_updated`, `courier.order.customer_updated`,
  `order.item_price_updated`, `order.item_quantity_set`, `order.item_removed`, `courier.order.item_*`,
  `admin.order.items_added`, `order.manual_items_added`, `order.delivery_fee_updated`, `order.soft_delete`,
  `staff.order.created`); unknown action → `other` without details; actor mapping (`staff:1/2` → pharmacy,
  `staff:3` → courier); ordering and 200 cap; `courier_view` drops/strips the forbidden items from criterion 2.
- `backend/tests/test_admin_order_fulfillment.py` (extend): `get_order` with mocked cursor returns `timeline`;
  queries use `%s` parameters and `LIMIT`; no raw `details` key in output.
- `backend/tests/test_courier_orders.py` (extend): `get_courier_order` returns the short timeline; list
  projection has no `timeline`.
- `tests/order-timeline.test.ts` (new): Russian text per kind, actor labels, money formatting with comma,
  latest change per item, unknown kind fallback, missing `timeline` → empty list.

## Risks

- **Deploy:** the timeline needs a new admin Lambda package (`backend.v1.admin_api`) deployed; the frontend must
  tolerate its absence (criterion 4). Deployment is the approver's/owner's decision — not done by this job.
- **Query cost:** `admin_audit_log` by `(resource_type, resource_id)` uses the existing index; matching removed
  items by `details` JSONB is not indexed — keep it restricted to `resource_type='order_item'` and the order's
  time window, and `LIMIT`. If it is too slow, drop removed-item matching rather than add an index (that would
  need migration 0027 — not in this job).
- **Privacy:** `order.customer_updated` / `courier.order.customer_updated` details hold customer PII and
  `order.delivery_fee_updated` holds the owner share; only the admin projection may include them; the courier
  projection must strip them; pharmacies get no timeline at all. Never forward raw `details`.
- **Parallel job 015** also edits `backend/v1/admin_api/lambda_function.py` and may add new audit actions
  (e.g. a single «Собран» with price/unavailable changes). Keep 016 edits to `get_order`/`get_courier_order` and
  the new module; unknown actions degrade to «Изменение заказа»; after both merge, a follow-up may map 015's
  new actions.
- **Data gaps:** `order_item_pharmacy_answers` rows are deleted on admin edits and audit rows for orders before
  the relevant jobs are missing, so old orders show a shorter history — expected, not a bug.
- No migration, no change to `backend/local-agent/agent.py` (Windows 7 agent unaffected). All new UI copy is
  Russian.

## More ideas for the owner

Необязательно, вне рамок этой задачи:
- Кнопка «Повторить заказ» у администратора и курьера — новый заказ с тем же клиентом и товарами.
- Фильтр «Есть проблемы» в списке заказов: нет в наличии, цена изменена аптекой, ждёт ответа дольше N минут.
- Отметка «Клиент не отвечает» с автоматической записью попыток звонка в историю.
- Печать/скачивание PDF-чека заказа с подтверждённой суммой для клиента.
- Отчёт по аптекам: сколько позиций «нет в наличии» и изменений цены за неделю — что докупать.
- Кнопка «Открыть в картах» по адресу клиента в карточке курьера.

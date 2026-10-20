# Build log — 013-ordering-flow-v2

## Round 1
- Commits (branch `factory/013-ordering-flow-v2`):
  - `df3c8ec` Derive order stage in Lambda, admin fulfillment block, Vatan 1 repricing and change notifications
  - `5ae0c3b` Show five order stages, admin fulfillment card, Vatan 1 row actions and 10-second alarm
  - `2636da2` Document job 013 stages, admin fulfillment, Vatan 1 row actions and change notifications
- Changed:
  - Backend: `backend/v1/shared/order_stage.py` (new: `assembled_sql(alias)`, `assembly_complete`, `order_stage`),
    `backend/v1/public_api/lambda_function.py` (track/create stage), `backend/v1/admin_api/lambda_function.py`
    (stage in list/get/courier/pharmacy rows, `fulfillment` + `_admin_fulfillment`, new `needs_attention`,
    «Ватан 1» repricing, `_pharmacy_change_notification`, claim regex), `backend/v1/telegram_notifier/lambda_function.py`
    (`pharmacy_item_change` branch, `format_pharmacy_change_message`).
  - Backend tests: new `test_order_stage.py` (mapper + the exact SQL fragment evaluated in in-memory SQLite),
    `test_public_tracking.py`, `test_admin_order_fulfillment.py`; extended `test_public_order_create.py`,
    `test_courier_orders.py`, `test_pharmacy_answers.py`, `test_pharmacy_assembly_items.py` (old «only Ватан 2»
    403 test replaced by Ватан 1 repricing + rejections), `test_staff_accounts.py` (012 attention tests replaced
    by 013 rule), `test_order_notification_settings.py`, `test_telegram_notifier.py`.
  - Frontend: new `src/lib/order-stage.ts`, `src/app/admin/orders/[order_id]/OrderFulfillment.tsx`,
    `src/app/staff/orders/PharmacyRowActions.tsx`, `src/app/staff/orders/usePharmacyItemPost.ts` (shared POST hook,
    also used by `PharmacyRoutedItems`); deleted `src/app/staff/orders/PharmacyAnswerForm.tsx`; updated tracking page,
    admin `ui.ts`/`OrderList.tsx`/`page.tsx`/`[order_id]/page.tsx`/`OrderStatusControl.tsx`/`orders-ui.css`,
    staff `status.ts`/`CourierOrderList.tsx`/`CourierOrderDetail.tsx`/`PharmacyOrderCard.tsx`/`PharmacyRoutedItems.tsx`/
    `PharmacyAlertBanner.tsx`/`StaffShell.tsx`/`staff.css`, `src/components/PharmacyOrderAlerts.tsx`,
    `src/lib/{pharmacy-alarm,pharmacy-alerts,pharmacy-answers,pharmacy-order,courier-checklist}.ts`,
    `src/lib/api-v1/{types,admin-types,staff-types}.ts`, `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts`.
  - Frontend tests: new `tests/order-stage.test.ts` (added to `test:frontend`); updated `pharmacy-alarm`,
    `pharmacy-alerts`, `pharmacy-order`, `pharmacy-answers`, `courier-checklist` tests.
  - Docs: `API_CONTRACT.md` (§7, §8.1, §8.1.2, §8.1.2a), `docs/PROJECT_CONTEXT.md` §5.
- Acceptance criteria:
  1. ✅ `track_orders` selects `assembled_sql("o") AS stage_assembled` in the same order SELECT (2 statements total,
     fixed); every AC1 case covered in `test_order_stage.py` by running the exact fragment on SQLite
     (no marks, single assembled, routed 1→2 partial/both, both-unavailable, staff-created, 1:1 statuses) and in
     `test_public_tracking.py` (stage per order, 2 statements, SELECT only, `{phone}` only). `create_order` → `assembling`.
  2. ✅ `/tracking` 5-step stepper from `TRACKING_STEPS`; admin list/detail and courier list/detail use the stage chip;
     `orderStageLabel` + fallback tested in `tests/order-stage.test.ts`; `grep -rn "В обработке" src` → nothing;
     `confirmed` = «Подтверждён» in `ui.ts` and `status.ts`.
  3. ✅ `get_order` adds one `_COURIER_ORDER_SELECT ... WHERE o.id = %s` read for website orders only; `fulfillment: null`
     for staff orders (no extra query) — `test_admin_order_fulfillment.py`. `OrderFulfillment.tsx` is a server component
     with no buttons/inputs, rendered only when `order.fulfillment` is truthy (old Lambda → hidden).
  4. ✅ `PharmacyRowActions` per own row (pending, answer fields present) posting the existing payload via
     `rowActionRequest`; routed rows merged from `routed_away` by `order_item_id` with orange «Ватан 2» / red chip;
     separate list and `PharmacyAnswerForm` removed; Lambda error message shown; old Lambda → no controls
     (`tests/pharmacy-order.test.ts`, `tests/pharmacy-answers.test.ts`).
  5. ✅ 403 removed; Ватан 1 reprices through `_reprice_items_from_base` (SQL/args, one audit row `staff:1`, no PII);
     rejections (other pharmacy 403, non-pending 409, bad price/price with unavailable 400) write nothing;
     same price → no writes, no `_notification` (`test_pharmacy_assembly_items.py`, `test_pharmacy_answers.py`).
  6. ✅ `needs_attention` = in queue ∧ assemblable > 0 ∧ mark ≠ assembled; `attention_since` rule
     (`test_staff_accounts.py`); `PHARMACY_ALARM_SECONDS === 10`, all 32 oscillators stop ≤ start+10 s;
     both pharmacies use the alarm; intervals via `remindIntervalMs` 60 s / 180 s; copy «Ждёт сборки N мин» and
     «Заказов ждут «Сборка сделана»: N»; courier/admin `NewOrderAlerts` untouched.
  7. ✅ `_notification` shape for routed/price/mixed, no PII keys, none for plain answers/repeat
     (`test_pharmacy_answers.py`); Next route uses `forwardChangeNotification` (strips the key, swallows notifier errors —
     `tests/pharmacy-answers.test.ts`); claim accepts `order:N:pharmacy-change:req_<32hex>` for owner/courier, rejects
     pharmacy recipients and malformed keys with 400, duplicate claim → not claimed
     (`test_order_notification_settings.py`); notifier sends owner + courier only, policy-gated prices, courier
     only «📦 Открыть заказ», unclaimed/second claim sends nothing (`test_telegram_notifier.py`).
  8. ✅ Gates below.
- Tests run (from the worktree):
  - `npm ci` → ok (node_modules not committed)
  - `npm run test:frontend` → 147 pass, 0 fail
  - `npm run lint` → clean
  - `npm run build` → success
  - `python3 -m unittest discover -s backend/tests -t .` → 399 run; only the 2 known main failures
    (`test_banner_title_can_be_empty_for_image_only_banner` ERROR, `test_quantity_on_delivered_order_recalculates_total_and_audits` FAIL)
- Open questions / not done:
  - Small copy choices beyond the spec letter: courier `pending → confirmed` button renamed «Принять заказ» → «Согласовано»
    (matches checklist step 4 action); admin detail button «Принять заказ» → «Подтвердить заказ»; checklist step-4 hint now
    «Статус станет «Подтверждён»». Alert toast title is «Заказ № X» (was «Новый заказ № X»).
  - «Ватан 2»'s own (non-routed) items also use the new row controls now, since `PharmacyAnswerForm` (the only UI offering
    «Цена отличается») was deleted.
  - The courier message under the default policy has no prices at all («цена изменена» without numbers), because
    `courier_telegram` has `item_client_total` off by default — as specified.
  - Claim key pinned to `req_[0-9a-f]{32}` (the Lambda `request_id()` format).
  - Nothing deployed; deploy order per spec: admin Lambda → notifier → public Lambda → Vercel. Confirm migration 0026 is live first.

## Round 2
- Commits:
  - `684ab64` Fit the five-step tracking stepper on phones, use colour tokens, confirm row unavailability
  - `b00fa92` Document after() for the pharmacy change notification
- Changed: `src/app/tracking/page.tsx`, `src/app/globals.css`, `src/app/admin/orders/orders-ui.css`, `src/app/staff/staff.css`,
  `src/app/staff/orders/PharmacyRowActions.tsx`, `src/app/staff/orders/PharmacyOrderCard.tsx`, `src/lib/pharmacy-order.ts`,
  `src/lib/pharmacy-answers.ts`, `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts`,
  `tests/pharmacy-answers.test.ts`, `tests/pharmacy-order.test.ts`, `API_CONTRACT.md`.
- Review findings addressed:
  - review-ux #1 / review-ui blocking 1 (stepper at 360/390 px) → the stepper is now an `<ol>` styled by `.tracking-stepper`
    in `globals.css`: 5 `minmax(0,1fr)` columns; label `font-size: clamp(10px, 2.8vw, 13px)`, `min-width: 0`,
    `overflow-wrap: anywhere`, `hyphens: auto` (`html lang="ru"`); dots 34 px → 28 px under 480 px; the details card
    padding is `clamp(16px, 4vw, 30px)`; `aria-current="step"` on the active step. Checked by reading the CSS only, not in a browser.
  - review-ui blocking 2 (hard-coded colours) → new tokens `--ao-teal(-soft)`, `--ao-orange(-soft)`, `--ao-neutral-soft`,
    `--c-teal(-soft)`, and globals `--primary-ring`, `--surface`, `--stepper-line`, `--text-subtle`. The «Собран» pill,
    `.od-ff-*` chips and checks, and the routed rows (`--c-orange`, `--c-brand-soft`, `--c-brand-dark`) use them.
    The tracking cancelled banner uses `--primary-light` / `--primary-dark`.
  - Non-blocking, done:
    - The admin `.od-progress` and staff `.c-progress` labels wrap (`min-width: 0`, `overflow-wrap`, `hyphens`) and drop to
      10 px on narrow screens.
    - Inline confirmation before «Нет в наличии» on a row: «Передать в Ватан 2?» for «Ватан 1», with «Да» / «Отмена».
    - Routed rows still waiting for «Ватан 2» show the hint «Ждёт ответа Ватан 2» (tested).
    - The selected-and-disabled button stays legible (opacity .8). «Изменить цену» is 40 px high.
    - The notification is sent through Next `after()`, so the pharmacy response no longer waits up to 8 s for Telegram
      (review-security note). It uses `splitChangeNotification` + `sendChangeNotificationSafely`, both tested.
  - `.od .sr-only`: `OrderFulfillment` renders inside the `.od` root of the detail page, so the rule applies.
- Tests run:
  - `npm run test:frontend` → 147 pass, 0 fail.
  - `npm run lint` → clean.
  - `npm run build` → exit 0. The sitemap "API v1 server configuration is incomplete" log appears only because there is no env locally.
  - Backend: not rerun; no Python changed in this round.
- Open questions / not done:
  - No real-browser check at 360/390 px was possible.
  - The toast title stays «Заказ № X» (body «Ждёт сборки N мин»).
  - Copy renames from round 1 still need the owner's confirmation.

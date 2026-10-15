# 003-courier-checklist-v2: Courier checklist reworked to the owner's 7 steps

## Owner request (verbatim)
Source: `factory/requests/2026-10-15-courier-pharmacy.md`.

> Чек-лист курьера: рассчитать доставку через Заза или Яндекс Карты → передать список лекарств нужной аптеке → получить подтверждение наличия и цены → позвонить клиенту, сообщить итоговые суммы и согласовать оплату и время доставки → забрать собранный заказ и выехать после подтверждения оплаты → позвонить клиенту за 5–10 минут до прибытия → передать заказ, кратко показать клиенту, как в следующий раз заказать через сайт, и завершить заказ. Отметки сохранять отдельно для каждого заказа. Для клиента оставить четыре статуса: «Подтверждён», «Собирается», «В пути», «Доставлен».

Owner decision (verbatim):

> - Статусы заказа в базе не менять (pending → confirmed → delivering → delivered; клиент видит «В обработке», «Сборка», «В пути», «Доставлен»). «Начать сборку» и «Собран» — внутренние отметки аптеки, видимые курьеру, а не новые статусы клиента.

## Goal
The courier (staff account 3, `/staff/orders`) currently sees the 8-step checklist that job 001
shipped. Replace it with the owner's 7 steps, using the owner's wording and order. Checks are
still saved per order in RDS through Lambda. Order statuses, `order_status_history` and
`/tracking` do not change. The job needs no new migration: the live table
`order_courier_checklist` (CHECK `step BETWEEN 1 AND 8`) already allows steps 1..7. Ticks already
stored under the old 8-step numbering are mapped on read (see below), so no in-flight order shows
a wrong tick.

### The 7 steps (titles are fixed, each is the owner's phrase with a capital first letter)
| # | Title | Kind |
|---|-------|------|
| 1 | Рассчитать доставку через Заза или Яндекс Карты | manual; keeps the link «К полю «Мне за доставку» ↓» |
| 2 | Передать список лекарств нужной аптеке | manual |
| 3 | Получить подтверждение наличия и цены | manual (job 005 may later derive it from the pharmacist action; not here) |
| 4 | Позвонить клиенту, сообщить итоговые суммы и согласовать оплату и время доставки | **status-linked** `pending → confirmed`, button «Согласовано», done when status ∈ {confirmed, delivering, delivered} |
| 5 | Забрать собранный заказ и выехать после подтверждения оплаты | **status-linked** `confirmed → delivering`, button «Выехал», done when status ∈ {delivering, delivered} |
| 6 | Позвонить клиенту за 5–10 минут до прибытия | manual |
| 7 | Передать заказ, кратко показать клиенту, как в следующий раз заказать через сайт, и завершить заказ | **status-linked** `delivering → delivered`, button «Доставлен», done when status = delivered |

These three status links keep the current code's meaning:
- step 4: agreeing with the customer confirms the order, which the customer sees as «Сборка»;
- step 5: leaving for the customer moves the order to «В пути»;
- step 7: completing the order marks it «Доставлен».

Manual steps = {1, 2, 3, 6}. Hints are short Russian lines that the builder writes. A
status-linked hint names the resulting status (step 4: «Статус станет «Собирается».»).

### Mapping of existing job-001 rows (no migration, no data rewrite)
The old manual steps were 1, 2, 4, 5 and 7. In the new numbering the same numbers can mean
something else, so new writes are told apart by the existing `completed_by` text column:
- New writes store `completed_by = 'staff:3/v2'`.
- **Any other `completed_by` value is a legacy row.** Legacy rows map on read like this:
  - old 1 «Указать плату за доставку» → new 1;
  - old 4 «Передать список в аптеку» → new 2;
  - old 2 «Позвонить клиенту», old 5 and old 7 are ignored. Steps 5 and 7 are now derived from
    status.
- v2 rows are read as-is and filtered to {1, 2, 3, 6}.
- Tick (`done: true`) for step N runs `INSERT ... ON CONFLICT (order_id, step) DO UPDATE SET
  completed_by = EXCLUDED.completed_by, completed_at = now() WHERE order_courier_checklist.completed_by
  <> EXCLUDED.completed_by RETURNING step`. A legacy row with the same number is converted to v2.
  A repeated v2 tick is a no-op.
- Untick (`done: false`) for step N deletes the row `step = N` whatever its marker. For N = 2 it
  also deletes a legacy row `step = 4` (`completed_by <> 'staff:3/v2'`). Without that, the
  untick would not stick.
- The mapping runs in SQL inside `_COURIER_ORDER_SELECT` and in the post-write re-read, using
  `array_agg(DISTINCT CASE ...) FILTER (WHERE ... IS NOT NULL)`, with no N+1 queries.
  `_checklist_steps` then filters to the manual set.

## Scope
- `src/lib/courier-checklist.ts`:
  - 7 steps as listed above;
  - `ChecklistStepNumber = 1..7`;
  - `ChecklistProgress.total: 7`;
  - the header comment is updated.

  `hasChecklist`, `isStepDone`, `isManualStep` and `checklistProgress` keep their signatures.
- `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx` (`ChecklistSection`):
  - renders the new steps;
  - the step-1 fee link stays;
  - the status buttons use the new step definitions;
  - the existing optimistic update, rollback and 409 handling are not changed.
- `src/app/staff/orders/CourierOrderList.tsx`:
  - shows «N из 7 шагов · <следующий шаг>»;
  - long titles must not break the row layout (CSS ellipsis in `src/app/staff/staff.css` if
    needed).
- `src/app/api/staff/orders/[order_id]/checklist/route.ts`: body validation accepts step 1..7 only,
  with Russian errors.
- `backend/v1/admin_api/lambda_function.py`:
  - `COURIER_CHECKLIST_MANUAL_STEPS = {1, 2, 3, 6}`;
  - validation is 1..7, with the error «Шаг должен быть числом от 1 до 7»; steps 4, 5 and 7 get
    `400 VALIDATION_ERROR` «Этот шаг отмечается сменой статуса заказа»;
  - the `'staff:3/v2'` marker, the legacy read mapping, and the upsert/delete rules described above;
  - the audit row `courier.order.checklist_updated` stays as it is.
- `API_CONTRACT.md` §8.1.2: update the checklist paragraph:
  - manual steps 1/2/3/6;
  - derived steps 4/5/7 and the statuses they map to;
  - step range 1–7;
  - the legacy-row mapping;
  - "no migration needed beyond 0023".
- Tests (see below).
- **Out of scope:**
  - pharmacy order screen (job 004), pharmacist actions/«Начать сборку»/«Собран» (005),
    notifications/push/sound (006);
  - any change to `orders.status` values, `order_status_history`, `src/app/tracking/*`, the public
    API, the admin UI, the Telegram notifier, `backend/local-agent/agent.py`, `backend/lambda-legacy`
    and API Gateway;
  - no new migration, and no edit to the already-applied `db/migrations/0023_order_courier_checklist.sql`;
  - no checklist for own (courier-created) or cancelled orders (unchanged).

## Acceptance criteria
1. `CHECKLIST_STEPS` has exactly 7 entries numbered 1–7. Their titles match the table above
   character for character, including «Заза», «5–10» with an en dash, and the commas. Manual steps
   are `[1, 2, 3, 6]`. Steps 4, 5 and 7 have links `pending→confirmed`, `confirmed→delivering` and
   `delivering→delivered`.
2. `checklistProgress` gives these results:
   - `pending` with `[1, 2]` → `{done: 2, total: 7, next: step 3}`;
   - `confirmed` with `[]` → `done: 1, next: step 1`;
   - `delivering` with `[]` → `done: 2`;
   - `delivered` with `[1, 2, 3, 6]` → `{done: 7, next: null}`.

   Cancelled and own orders return `null`.
3. Lambda `PATCH /v1/staff/orders/{id}/checklist` returns these errors:
   - steps 4, 5 and 7 → `400 VALIDATION_ERROR`;
   - steps 0, 8 and non-integers → `400`;
   - unknown keys → `400`;
   - cancelled order → `409 ORDER_STATUS_CONFLICT`;
   - non-website order → `409 CHECKLIST_NOT_AVAILABLE`;
   - missing order → `404`.

   Steps 3 and 6 are accepted and persisted with `completed_by = 'staff:3/v2'`. A real change
   writes the audit row, and a repeat is a no-op success without an audit row.
4. Legacy mapping:
   - an order whose stored rows are `(1,'staff:3'), (2,'staff:3'), (4,'staff:3'), (5,'staff:3'),
     (7,'staff:3')` returns `checklist_steps = [1, 2]` from both the list/detail select and the
     PATCH re-read;
   - ticking step 2 on an order with a legacy `(2,'staff:3')` row converts that row to v2 and
     returns step 2 as done;
   - unticking step 2 removes both the v2 row 2 and the legacy row 4.
5. The courier card for a website order shows the 7 Russian steps in order, and ticks are still
   there after a reload. The «Согласовано» button (step 4) moves `pending→confirmed`, «Выехал»
   (step 5) moves `confirmed→delivering` and «Доставлен» (step 7) moves `delivering→delivered`,
   all through the existing status endpoint. The courier list shows «N из 7 шагов». Check this by
   hand on a local/dev build; do not use production.
6. `rg "order_courier_checklist" src` returns nothing. `git diff --stat` shows no file under
   `db/migrations/` and no change to `src/app/tracking/` or `backend/local-agent/`.
7. `npm run lint`, `npm run build`, `npm run test:frontend` and
   `python -m unittest discover backend/tests` pass. The only allowed failures are the 2 known
   failures already on main, and the report must name them.

## Tests
- `tests/courier-checklist.test.ts` (rewrite the 8-step assertions) asserts:
  - there are 7 steps with exact titles (criterion 1);
  - the manual set is `[1, 2, 3, 6]`;
  - the status links and their `doneWhen` sets;
  - the progress cases in criterion 2;
  - `isManualStep(4|5|7|8) === false`;
  - cancelled/own → `null`.
- `backend/tests/test_courier_orders.py` (extend the checklist block, mocked `transaction`/`_tx`):
  - tick step 3 and step 6 → parameterized upsert containing `ON CONFLICT (order_id, step) DO
    UPDATE` and the `'staff:3/v2'` parameter, plus an audit row;
  - steps 4, 5, 7 and 8 → `VALIDATION_ERROR` before any DB call;
  - untick step 2 → the delete SQL covers the legacy step 4 and is parameterized;
  - `_COURIER_ORDER_SELECT` contains the legacy CASE mapping (old 4 → 2, `completed_by` marker);
  - `_checklist_steps` drops values outside {1, 2, 3, 6};
  - existing 404/409 tests keep passing with the new step numbers.

## Risks
- **Live data.** Production already has `order_courier_checklist` rows written by job 001. The
  design changes no schema or data: the mapping is read-side, and legacy rows are converted only
  when a courier ticks them. The trade-off: old «Позвонить клиенту» ticks (old step 2) are dropped.
  They have no exact match among the new steps; the closest are new step 4 or 6. On in-flight orders
  the courier ticks again. Old step 5/7 ticks are replaced by status derivation. The approver should
  confirm this is acceptable.
- **Deploy order.** No migration, but the Lambda and the Vercel frontend must go out together.
  The old frontend against the new Lambda would send steps 4/5/7 (old manual numbers) and get
  `400`, with a Russian error and rollback. The new frontend against the old Lambda would get
  `400` for step 3/6 and accept step 4. Deploy the Lambda and Vercel back to back. The builder must
  not deploy.
- **Lambda/RDS boundary.** All SQL stays in Lambda and is parameterized. Next.js only proxies. The
  status-derived steps are never trusted from the client.
- **Security.** `session_account(courier=True)` and the `order_id` regex stay on both layers.
  `completed_by` is set server-side only.
- **Status semantics.** No new statuses (owner decision). Step 4's button confirms the order. The
  customer then sees «Сборка» even though, per the owner, pharmacy picking starts with «Начать
  сборку» in job 005. This is acceptable under the decision, but job 005 may want to revisit
  whether step 3 becomes derived from the pharmacist's «В наличии, цена верна».
- **Russian copy.** The step titles are long. Check the mobile layout of the list row and the card.
- **Windows 7 agent.** Not affected: `backend/local-agent/agent.py` is not touched.

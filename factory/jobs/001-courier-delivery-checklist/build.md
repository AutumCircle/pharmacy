# Build log: 001-courier-delivery-checklist

## Round 1
- Commits: a41f503 Add courier delivery checklist to website order cards
- Changed:
  - `db/migrations/0023_order_courier_checklist.sql` (new)
  - `backend/v1/admin_api/lambda_function.py`: `_COURIER_ORDER_SELECT` gets `checklist_steps` via `LEFT JOIN LATERAL (array_agg ... ORDER BY step)`; `COURIER_CHECKLIST_MANUAL_STEPS = {1,2,4,5,7}`; `_courier_order_row` normalizes `checklist_steps`; new `update_courier_order_checklist`; route `PATCH /v1/staff/orders/{id}/checklist` with `session_account(courier=True)`
  - `src/lib/courier-checklist.ts` (new): `CHECKLIST_STEPS`, `MANUAL_CHECKLIST_STEPS`, `isManualStep`, `hasChecklist`, `isStepDone`, `checklistProgress`
  - `src/app/api/staff/orders/[order_id]/checklist/route.ts` (new)
  - `src/lib/api-v1/staff-server.ts` (`updateCourierOrderChecklist`), `src/lib/api-v1/staff-types.ts` (`checklist_steps: number[]`)
  - `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx` (`ChecklistSection`), `src/app/staff/orders/CourierOrderList.tsx`, `src/app/staff/staff.css`
  - `API_CONTRACT.md` §8.1.2; `package.json` (`test:frontend` + new test)
  - Tests: `tests/courier-checklist.test.ts` (new), `backend/tests/test_courier_orders.py`, `backend/tests/test_staff_accounts.py`
- Acceptance criteria:
  1. ✅ The migration is `BEGIN/COMMIT` with `CREATE TABLE IF NOT EXISTS` only, so it adds the table and changes nothing on `orders` or its CHECK. Checked by reading it; it was not run.
  2. ✅ Ticking a step uses `INSERT ... ON CONFLICT (order_id, step) DO NOTHING RETURNING step`, and unticking uses `DELETE ... RETURNING step`. The response re-reads the steps. GET and list both get `checklist_steps` from the shared select. Repeating a request is a no-op with no audit row. Unit tests cover this (`test_checklist_tick_*`, `*_untick_*`, `*_repeated_request_*`, `test_courier_select_projects_checklist_steps_without_n_plus_one`). There is no live DB check.
  3. ✅ Covered by `test_checklist_validates_payload_before_database`: unknown or missing keys, `"2"`, `2.0`, `True`, 0, 9, non-bool `done`, and steps 3/6/8 all give 400. Covered by `test_checklist_rejects_cancelled_own_and_missing_orders`: 409 ORDER_STATUS_CONFLICT, 409 CHECKLIST_NOT_AVAILABLE (own and pharmacy orders) and 404. Covered by `test_only_courier_can_tick_checklist` (in test_staff_accounts): the pharmacy session gets 403 and the courier gets 200. The audit action `courier.order.checklist_updated` is asserted.
  4. ✅ `tests/courier-checklist.test.ts`: pending [1,2] → done 2, next step 3; delivered with all manual steps → 8, next null; delivering [] → 2.
  5. ✅ (code + build; not clicked in a browser) The card shows all 8 steps in order. Done steps get a green check and the `done` class, and the next step gets the `current` highlight. Manual steps are checkboxes with optimistic save and rollback plus a Russian error. Steps 3/6/8 show a button only when the status matches the step's `from`, and the button calls the existing `changeStatus` (status endpoint, unchanged 409 handling). The component is keyed on status+steps, so after `router.refresh` it re-renders from server data. Step 1 links to `#courier-fee`.
  6. ✅ The list shows «N из 8 шагов · <next title>» (or «· всё готово») only when `checklistProgress` is not null, which means website orders that are not cancelled. Own orders get nothing.
  7. ✅ `grep -rn order_courier_checklist src` → no output. `src/app/tracking` is untouched. `CourierOrderStatus`, `status.ts` and `order_status_history` are unchanged.
  8. ✅ lint, build and test:frontend pass. The backend suite has only the 2 known failures on main.
- Tests run (in the worktree):
  - `npm ci` → ok
  - `npm run lint` → clean
  - `npm run build` → success (the sitemap "API v1 server configuration is incomplete" log is from the missing env and was already there)
  - `npm run test:frontend` → 39/39 pass
  - `python3 -m unittest discover -s backend/tests -t .` → 247 tests; only the 2 known failures (`test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`)
- Decisions / deviations:
  - The FK is `REFERENCES orders(id) ON DELETE CASCADE`, the same as `order_status_history` in 0001. The spec only said `REFERENCES orders(id)`. With the cascade, any legacy hard delete or wipe can't be blocked by checklist rows.
  - An audit row is written only when a row was really inserted or deleted. Repeating an idempotent request writes no audit row.
  - The Next.js route also rejects steps 3/6/8 (400, «Этот шаг отмечается сменой статуса заказа»). Lambda still enforces this on its own.
  - Owner decision applied: no new statuses. Step 3 is pending→confirmed. Step 4 is a checkbox only.
  - The original feature text was not in the repo, so I wrote the step titles and hints myself: 1 «Указать плату за доставку», 2 «Позвонить клиенту», 3 «Подтвердить заказ», 4 «Передать список в аптеку», 5 «Забрать заказ в аптеке», 6 «Выехать к клиенту», 7 «Вручить заказ и получить оплату», 8 «Отметить доставку». The owner can reword them in `src/lib/courier-checklist.ts`.
- Open questions / not done:
  - Migration 0023 must be applied to RDS before the Lambda deploy: backup → staging → apply 0023 → Lambda → Vercel. Without the table, the courier list query fails. I did not run or deploy anything.
  - The UI was not checked by hand in a browser (there is no backend/env locally).
  - If a status-button error happens, it shows in the existing error line under the fee block, not inside the checklist.

# Build log: 003-courier-checklist-v2

## Round 1
- Commits: 307649d Courier checklist v2: owner's 7 steps, legacy row mapping on read
- Changed:
  - `src/lib/courier-checklist.ts`: 7 steps with verbatim titles, `ChecklistStepNumber = 1..7`, `total: 7`, new header comment
  - `src/app/api/staff/orders/[order_id]/checklist/route.ts`: step must be 1..7 («Шаг должен быть числом от 1 до 7»), steps 4/5/7 get «Этот шаг отмечается сменой статуса заказа»
  - `src/app/staff/staff.css`: `min-width: 0` on `.c-row-checklist`, which already had the ellipsis/nowrap
  - `src/lib/api-v1/staff-types.ts`: doc comment only
  - `backend/v1/admin_api/lambda_function.py`: `COURIER_CHECKLIST_MANUAL_STEPS = {1,2,3,6}`, `COURIER_CHECKLIST_MARKER = 'staff:3/v2'`, shared `_COURIER_CHECKLIST_STEP_SQL` CASE / `_COURIER_CHECKLIST_AGG_SQL` (`array_agg(DISTINCT CASE …) FILTER (WHERE … IS NOT NULL)`), used in `_COURIER_ORDER_SELECT` and in the post-write re-read; upsert `ON CONFLICT … DO UPDATE … WHERE completed_by <> EXCLUDED.completed_by`; untick of step 2 also deletes legacy step 4 (parameterised marker); audit row unchanged
  - `API_CONTRACT.md` §8.1.2: checklist paragraph rewritten (manual 1/2/3/6, derived 4/5/7 and their statuses, range 1–7, legacy mapping, no migration beyond 0023)
  - `tests/courier-checklist.test.ts` (rewritten), `backend/tests/test_courier_orders.py` (extended)
  - `CourierOrderDetail.tsx` / `CourierOrderList.tsx`: no edits needed. Both render from `CHECKLIST_STEPS` / `checklistProgress`, so the new steps, buttons («Согласовано», «Выехал», «Доставлен») and «N из 7 шагов» come through as they are. Optimistic update, rollback and 409 handling are untouched.
- Acceptance criteria:
  1 ✅ the frontend test checks the 7 exact titles (including «Заза», the en dash in «5–10» and the commas), manual `[1,2,3,6]`, and links/doneWhen for 4/5/7.
  2 ✅ the frontend test covers pending[1,2] → 2/7 next 3; confirmed[] → 1 next 1; delivering[] → 2; delivered[1,2,3,6] → 7 next null; cancelled/own → null.
  3 ✅ backend tests: steps 4/5/7/8/0/9, non-integers and extra keys give VALIDATION_ERROR before any DB call; cancelled → 409 ORDER_STATUS_CONFLICT; non-website → 409 CHECKLIST_NOT_AVAILABLE; missing → 404, each for steps 1/3/6; steps 3/6 upsert with the `'staff:3/v2'` parameter plus an audit row; a repeat is a no-op with no audit row.
  4 ✅ mostly. The CASE expression is run in in-memory sqlite: legacy rows (1,2,4,5,7 'staff:3') give [1,2]; legacy 2 converted to v2 gives [2]; after the untick only legacy 1 remains. The select and the re-read SQL contain the mapping. The tick-convert and untick-2 SQL/params are asserted against mocks. The Postgres-only `array_agg … FILTER` was not run against a real Postgres.
  5 ⚠ not checked by hand. No local/dev Lambda+RDS was available and production is off limits. It is covered by code paths (components unchanged, driven by the lib) and by `npm run build`.
  6 ✅ `grep -rn order_courier_checklist src` → nothing; `git diff --stat main` shows no `db/migrations/`, `src/app/tracking/` or `backend/local-agent/` file.
  7 ✅ lint, build, frontend and backend tests pass apart from the 2 known failures.
- Tests run (in the worktree, after `npm ci`):
  - `npm run test:frontend` → 48 pass, 0 fail
  - `npm run lint` → clean
  - `npm run build` → success
  - `python3 -m unittest discover -s backend/tests -t .` → 253 run; only the 2 known main failures: `test_banner_title_can_be_empty_for_image_only_banner` (ERROR) and `test_quantity_on_delivered_order_recalculates_total_and_audits` (FAIL)
  - `python3 -m unittest backend.tests.test_courier_orders` → 39 OK
- Open questions / not done:
  - Hand check of criterion 5 on a dev build is still needed.
  - Risk from the spec stands: old «Позвонить клиенту» ticks (legacy step 2) are dropped. Re-ticking legacy step 1 converts the row and writes an audit row even though the visible state does not change.
  - Deploy the Lambda and Vercel back to back (no migration).

# Build log — 016-order-view-history

Worktree: `.factory-worktrees/016-order-view-history`, branch `factory/016-order-view-history`.

## Round 1
- Commits:
  - `1de48f6` Order history timeline in admin and courier order reads
  - `8c2551b` Order view for admin and courier with order history
- Changed:
  - Backend: `backend/v1/shared/order_timeline.py` (new, pure), `backend/v1/admin_api/lambda_function.py`
    (`get_order`, new helper `_order_audit_rows`, `get_courier_order`, import only), tests
    `backend/tests/test_order_timeline.py` (new), `test_admin_order_fulfillment.py`, `test_courier_orders.py`
    (existing get_courier_order tests now stub `fetchall` and read `call_args_list[0]`, since two reads follow the main SELECT).
  - Frontend: `src/lib/order-timeline.ts` (new), `src/lib/api-v1/staff-types.ts` (`OrderTimelineEvent`,
    `CourierOrder.timeline?`), `src/lib/api-v1/admin-types.ts` (`AdminOrderDetail.timeline?`),
    `src/app/admin/orders/[order_id]/page.tsx`, `OrderItems.tsx` (table), `OrderFulfillment.tsx` (checklist first,
    per-item answers moved to the table), `OrderCustomerEditor.tsx` (phone `tel:` link, mobile order class),
    new `OrderTimeline.tsx`, `OrderStatusControl.tsx` / `OrderDeliveryEditor.tsx` (only the `od-oN` order class),
    `src/app/admin/orders/orders-ui.css`, `src/app/staff/orders/[order_id]/CourierOrderDetail.tsx`,
    `src/app/staff/staff.css`, `tests/order-timeline.test.ts` (added to `test:frontend`), `package.json`.
  - Docs: `API_CONTRACT.md` (admin `timeline`, courier short timeline/filtering), `docs/PROJECT_CONTEXT.md` §5 item 9.
- Design notes:
  - Events: `{at, kind, actor, pharmacy_id?, order_item_id?, medicine_name?, from_status?, to_status?, answer?,
    previous_price?, new_price?, client_price?, step?, done?, reason?, state?, count?, fields?}`. Extra keys beyond the
    spec list: `client_price` (new client price after a pharmacy price change), `state` (assembly mark), `count`
    (items added); `fields` = `[{field, previous, current}]`.
  - Creation is one `created` event at `orders.created_at`; the history row `NULL -> status` and the audit
    `staff.order.created` are folded into it (actor taken from them when the creator is unknown). The audit
    `courier.order.status_changed` is dropped when the matching `order_status_history` row (same from/to, ±120 s) exists.
  - `pharmacy.order.items_answered` expands to one event per item (`pharmacy_answer` / `pharmacy_routed`);
    `pharmacy.order.item_price_changed` likewise (`pharmacy_price_changed`).
  - Admin: existing status-history read now also selects `id` (stripped from `status_history` output); 2 extra reads
    (order + current items by index; removed items by `details` JSONB + `created_at >= orders.created_at`), both `LIMIT 201`.
    Courier: 2 extra reads (status history `LIMIT 201`; order audit filtered to `COURIER_ACTIONS`, `LIMIT 201`).
  - Courier keeps pharmacy price changes (base prices) — the courier projection already exposes `base_unit_price`;
    only base prices of admin edits are hidden (whole `item_updated` kind is dropped).
- Acceptance criteria:
  1. ✅ `get_order` returns `timeline` + `timeline_truncated`; mapping/whitelist/ordering/cap unit-tested
     (`test_order_timeline.py`, `test_get_order_returns_timeline_with_parameterized_bounded_audit_reads`,
     `test_timeline_truncated_when_a_read_hits_the_limit`: `%s` params, `LIMIT %s`, no ids/refs in SQL text, no `details`).
  2. ✅ `get_courier_order` returns the courier view; `CourierViewTests` assert no phone/address values, owner amount,
     admin base prices, `deleted`, `fields`, admin names, non-cancel reasons; `test_courier_list_has_no_timeline`
     (list unchanged, one query). Pharmacy endpoints untouched.
  3. ✅ (code + CSS, not visually checked in a browser) right column: client → «Курьер и аптеки» → status → delivery →
     deletion; < 1000 px flex order: client(1), checklist(2), items(3), status(4), history(5), delivery(6), deletion(7).
     Edit/status/delete components unchanged apart from the order class.
  4. ✅ table columns: Товар (+ ID/цена аптеки, latest change line from timeline), Аптека и ответ (Ватан N,
     «передано из Ватан 1», answer chip), Кол-во, Цена клиенту, Сумма (+ profit), edit button; below:
     «Сумма заказа», «Подтверждено аптеками» / «ждёт ответа». `meta` is optional; staff orders (`fulfillment: null`) and
     no `timeline` render plain rows (types allow absence; build passes).
  5. ✅ `OrderTimeline` lists events with `formatOrderDateTime`, actor label, Russian text; unknown → «Изменение заказа»;
     truncated → «Показаны последние 200 событий»; older Lambda → old status-history list. Texts unit-tested.
  6. ✅ (code + CSS, not visually checked) courier: header/progress → client (phone `tel:` link, «Позвонить» min-height 52 px)
     → items grouped «Забрать в Ватан 1/2» / «Нет в наличии» with group sum, assembly mark and confirmed sum → checklist →
     fee → `<details>` «История» (collapsed) → sticky action bar. Actions/handlers unchanged (only block order and
     the separate «Сборка в аптеках» block merged into the group headers).
  7. ✅ see Tests run.
- Tests run (from the worktree):
  - `python3 -m unittest discover -s backend/tests -t .` → 439 tests, 3 failing, all pre-existing on `main`:
    `test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`
    (known), and `test_has_more_and_cursor_round_trip_for_delivered` (orders_insights_drilldown; fails identically
    in the main checkout today — date-dependent cursor, unrelated). No new failures.
  - `npm run test:frontend` → 181 pass, 0 fail (includes `tests/order-timeline.test.ts`, 7 tests).
  - `npm run lint` → clean. `npm run build` → success. (`npx tsc --noEmit` only reports the pre-existing
    `tests/category-icon-preview.test.ts` NODE_ENV error.)
- Open questions / not done:
  - Not checked in a real browser (needs an admin/staff session and the Lambda); layout verified by build only.
  - Deploy of the admin Lambda package is needed for `timeline`; the frontend tolerates its absence. Not deployed.
  - Removed-item matching uses unindexed JSONB filters bounded by `resource_type`, the order time window and `LIMIT`;
    if slow in production, drop that second read (spec risk note) rather than adding an index.
  - Job 015 audit actions (if new) will show as «Изменение заказа» until mapped in a follow-up.

## Round 1b — merge main
- Commits: f2d4fa6 Merge main (job 015) into factory/016-order-view-history
- Conflict: `docs/PROJECT_CONTEXT.md` only (both jobs added item 9). Kept both: job 015 stays 9, job 016 renumbered to 10. No other conflicts and no leftover markers.
- Timeline mapping: no change needed. Job 015 adds no new audit action: «Собран» reuses `pharmacy.order.assembly_marked` (`to_state: "assembled"`, already mapped to `assembly_marked`), and the read-only `pharmacy-answers` 409 writes no audit.
- Tests run (worktree):
  - `npm run test:frontend` → 185 pass, 0 fail
  - `npm run lint` → clean
  - `npm run build` → compiled OK (sitemap API_CONFIGURATION_ERROR warning expected without env)
  - `python -m unittest discover -s backend/tests -t .` → 459 run; 1 failure + 2 errors: the 2 known ones plus `test_orders_insights_drilldown.PaginationTests.test_has_more_and_cursor_round_trip_for_delivered` ("cursor is invalid"). That third one also fails on `main`: it depends on the date (fixture timestamps now fall before the rolling `since` window). Not caused by this job.
- Open: the date-dependent drilldown test should be fixed separately (freeze `now` in the test).

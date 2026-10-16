# Build log: 007-orders-overview-drilldown

## Round 1
- Commits: a02930d Orders overview: clickable cards with drill-down lists, courier average per day
- Changed:
  - `backend/v1/admin_api/lambda_function.py`: new `orders_insights_drilldown` + route `GET /v1/admin/orders/insights/orders`. It is placed right after `orders/insights` and before the generic `orders/{id}`, and returns a `success_document`. I refactored `orders_insights` to use shared constants without changing its response: `_insights_period`, `_ITEM_TOTALS_JOIN`/`_ITEM_SALES`/`_ITEM_BASE`, `_ORDERED_STATUS`/`_CANCELLED_STATUS`/`_CREATED_IN_PERIOD`, `_CLIENTS_PERIOD_CTE`/`_CLIENTS_SUMMARY_SELECT`. `DELIVERED_DAY_CTE` and `_ORDER_CREATED_TZ` are reused unchanged.
  - `backend/tests/test_orders_insights_drilldown.py` (new, 15 tests)
  - `src/app/admin/orders/insights-metrics.ts` (new, pure helpers: `DRILL_METRICS`, `parseDrillMetric`, `DRILL_TITLES`, `drillExplanation`, `courierAveragePerDay`)
  - `tests/orders-insights-metrics.test.ts` (new), added to `test:frontend` in `package.json`
  - `src/lib/api-v1/admin-server.ts` (`getAdminOrdersInsightsDrilldown`), `src/lib/api-v1/admin-types.ts` (`OrdersDrillMetric`, `OrdersDrillOrder`, `OrdersDrillClient`, `OrdersDrillResponse`)
  - `src/app/admin/orders/page.tsx`: `drill` / `drill_cursor` params. The drill request runs in parallel and its failure is caught, which gives an in-panel error.
  - `src/app/admin/orders/OverviewSections.tsx`: `KpiGrid` cards are now `Link`s, plus a new `DrillPanel`
  - `src/app/admin/orders/FinanceView.tsx`: «В среднем за день»
  - `src/app/admin/orders/orders-ui.css`, `API_CONTRACT.md` §8.1.3
- Acceptance criteria:
  1. ✅ Covered by `CardMatchesDrilldownTests`. It runs `orders_insights` and each drill metric against mocked aggregates and asserts:
     - count/sum/profit/clients are equal;
     - every drill query gets the same `since` param as the card query;
     - the card and drill SQL contain the same shared fragments (`_CREATED_IN_PERIOD`, `_ITEM_TOTALS_JOIN`);
     - the clients summary SQL is byte-identical to the card's.

     Per-metric SQL tests:
     - `ordered`: `status <> 'cancelled'` with the creation-time filter;
     - `cancelled`: `status = 'cancelled'`;
     - delivered/average_check: start with `DELIVERED_DAY_CTE`, use `e.delivered_at >= %s`;
     - `profit`: `ORDER BY profit ASC, id ASC`.
  2. ✅ `ValidationTests` cover:
     - unknown param, days 14 / x, unknown metric, limit 101 / 0 / -1 / non-int;
     - malformed cursors: bad base64, missing/str/bool id, naive time, time before the period, wrong key for the metric, NaN / non-numeric / non-string profit, bad clients time.

     `RoutingTests` cover:
     - dispatch goes to `orders_insights_drilldown`, not `get_order`;
     - 403 without the admin authorizer;
     - 400 `VALIDATION_ERROR` for a bad metric via `lambda_handler`.

     `PaginationTests` cover the `has_more` / `next_cursor` round trip, the delivered keyset `(delivered_at, id) < (%s,%s)` and the profit keyset `(profit, id) > (%s,%s)` with a Decimal param. `metric` only indexes fixed dicts of SQL; all values are `%s` params.
  3. ✅ by code review and `npm run build` only (not clicked in a browser). Each card is an `<a>` (keyboard-focusable, `:focus-visible` outline) to `?view=overview&days=…&drill=<metric>#drill`, with `aria-current="true"` on the open card. Period tabs keep `drill` (plus `#drill`). «Закрыть» links to the same URL without `drill`. `parseDrillMetric` turns unknown values into `null`, so no panel is shown and no request is made.
  4. ✅ by code review. The profit table has columns «Сумма» (sales), «Цена аптеки» (base) and «Прибыль». Negative rows get `ao-drill-loss` (light red background, red left bar, red profit and a screen-reader «Убыток:» prefix). The summary shows «Прибыль с товаров» = `summary.profit` (= `totals.profit` per AC1). The order number links to `/admin/orders/{order_id}`.
  5. ✅ Hints:
     - «Заказали»: «N заказов · созданы за период, кроме отменённых»;
     - «Доставлено»: «N доставок · по дате доставки»;
     - «Средний чек» and «Прибыль с товаров» keep their old hints.

     The panel shows `drillExplanation(metric)` (Russian copy, unit-tested). All new copy is Russian.
  6. ✅ `courierAveragePerDay(insights.daily).average` is formatted with `money()`. The hint reads «за N день/дня/дней с доставками»: I used the proper declension via `count()`, so it is «за 0 дней», not the literal «за N дней». With 0 working days the card shows `0 с.`; this is unit-tested with no division.
  7. ✅ lint, build, frontend tests and backend tests all pass, except the 2 known `main` failures (see below).
- Tests run (in the worktree, after `npm ci`):
  - `npm run lint` → clean
  - `npm run test:frontend` → 63 tests, 63 pass
  - `npm run build` → success
  - `python3 -m unittest backend.tests.test_orders_insights_drilldown backend.tests.test_orders_insights` → 17 OK
  - `python3 -m unittest discover -s backend/tests -t .` → 268 tests. Only the two known `main` failures remain: `test_banner_title_can_be_empty_for_image_only_banner` (ERROR) and `test_quantity_on_delivered_order_recalculates_total_and_audits` (FAIL). No new failures.
- Not run: `npm run dev` with a mocked upstream. Criteria 3–5 were checked by code review only.
- Open questions / notes:
  - **Deploy order:** the admin Lambda must be deployed before or together with Vercel. Until then the panel shows «Не удалось загрузить список. Попробуйте обновить страницу.» and the rest of the overview works. `ANY /v1/admin/{proxy+}` already covers the route.
  - **Clients tiebreaker (deviation):** the spec says `first_order_at DESC, phone ASC`. I order by `first_order_at DESC, first_order_id DESC` instead (the internal id of the client's first order). This keeps phone numbers out of the cursor, and so out of URLs and access logs. It is still deterministic. `phone_normalized` is not returned.
  - **Delivered count:** the card's `delivered_count` sums website (`NULL`), courier (3) and pharmacy (1, 2) rows. The drill counts all eligible rows. These are equal because `staff_accounts.account_id` is constrained to {1, 2, 3} (migration 0017).
  - **Profit keyset at 90 days:** profit is computed per order, so no index can serve that ordering. Each page recomputes the delivered set for the period, as `orders_insights` already does. This should be fine at current volumes. No migration was added.
  - Extra row field `order_total` is returned. «Заказали»/«Отменено» rows show it as «Сумма», since the card sums `order_total`.
  - Courier average placement («Финансы», not «Обзор») and the repeat-medicines follow-up (job 008) still need owner confirmation, as the spec notes.

## Round 1b — merge main
- Note: the worktree had been removed; recreated it with `git worktree add .factory-worktrees/007-orders-overview-drilldown factory/007-orders-overview-drilldown`.
- Commits: d71997a Merge main into factory/007-orders-overview-drilldown
- Changed: package.json (conflict only). `test:frontend` now lists both `tests/tracking-guard.test.ts` (job 006) and `tests/orders-insights-metrics.test.ts`. No other conflicts; everything else from main (API_CONTRACT.md, tracking route/page, tracking-guard, client-reads, tsconfig, factory files) auto-merged cleanly. No conflict markers left.
- Tests run (in worktree):
  - `npm run test:frontend` → 72 pass, 0 fail
  - `npm run lint` → exit 0, no findings
  - `npm run build` → exit 0
  - `python3 -m unittest discover -s backend/tests -t .` → 268 tests; only the 2 known main failures (`test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`), no new failures
- Not pushed, not deployed.

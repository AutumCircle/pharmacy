# 007-orders-overview-drilldown: Clickable overview cards with order drill-down, card hints, courier average per day

## Owner request (verbatim)

я хочу чтобы в панели заказы обзор вот эти шесть панелей которые говорят средний чек прибыль товара отменено они были все кликабельны потому что я хочу узнать какие именно заказы у меня там прибыль с товаров минус 105 самолей и, например, доставленные и заказания, они чем отличаются. И, например, если лекарство, которое заказали дважды. И мне, я еще хочу, чтобы мне выводили средний, среднюю заработную плату курьера за день.

## Interpretation

The request was dictated by voice. This is how the spec reads it; the owner can correct any point.

- "панели заказы обзор" is `/admin/orders` with the «Обзор» tab (`view=overview`). The six cards are
  rendered by `KpiGrid` in `src/app/admin/orders/OverviewSections.tsx`: «Заказали», «Доставлено»,
  «Средний чек», «Прибыль с товаров», «Отменено», «Клиенты». Their numbers come from
  `orders_insights` in `backend/v1/admin_api/lambda_function.py` (`GET /v1/admin/orders/insights`).
- "все кликабельны": each card opens a list of exactly the orders (or, for «Клиенты», the
  clients) behind its number, for the same period (Сегодня / 7 / 30 / 90 дней).
- "прибыль с товаров минус 105 самолей": the «Прибыль с товаров» card shows −105 с. (TJS;
  "самолей" is a mistranscription of "сомони"). Today profit per delivered order is
  `SUM(line_total) − SUM(COALESCE(base_unit_price, 0) × quantity)`. The total is negative when, in
  some orders, the pharmacy price is higher than the client price. The drill-down shows sales, the
  pharmacy price and profit for each order, with the most negative orders first.
- "доставленные и заказанные, чем отличаются": the two cards count different things.
  - «Заказали» counts orders **created** in the period that are not cancelled, in any status
    (new, being assembled, on the way, delivered). It uses the creation date.
  - «Доставлено» counts orders with status `delivered` whose **delivery date** is in the period.
    This can include orders created before the period.

  This job adds a short Russian hint to each card and a one-line explanation above each
  drill-down list.
- "лекарство, которое заказали дважды": read as "medicines that appear in two or more orders in
  the period" (repeat medicines). It could also mean "the same client ordered the same medicine
  again". Either way it needs a new aggregate. **It is split out to a follow-up job (see Scope).**
- "средняя заработная плата курьера за день": the average courier earnings per day. Courier
  earnings are already modelled as `orders.delivery_courier_amount` on delivered orders, summed by
  Dushanbe delivery day (`insights.daily[].courier_fee`). The average is
  `sum(courier_fee) / number of days in the period with courier_fee > 0` («за рабочий день»). It is
  shown in the «Заработок курьера» card of the «Финансы» tab, next to «В среднем за доставку». If
  the owner wants it on «Обзор» instead, that is a one-line move.

## Goal
The admin sees six summary numbers on «Заказы → Обзор», but cannot see which orders make them
up. The current −105 с. profit cannot be explained from the UI. After this job:
- Each of the six cards is a link. It opens a paginated list of exactly the orders (or clients)
  counted in that number, for the selected period.
- The profit list shows profit per order, with losses first.
- Each card carries a hint that makes the «Заказали» vs «Доставлено» difference explicit.
- The «Финансы» tab shows the courier's average earnings per working day.

Aggregation, filtering and pagination stay in parameterized SQL in the admin Lambda.

## Scope
- **Lambda** (`backend/v1/admin_api/lambda_function.py`): add a read-only function
  `orders_insights_drilldown(query)` and the route `GET /v1/admin/orders/insights/orders`.
  - Query parameters:
    - `days` (1|7|30|90, default 7);
    - `metric` (`ordered` | `delivered` | `average_check` | `profit` | `cancelled` | `clients`);
    - `cursor`;
    - `limit` (default 50, max 100).
  - Any other key gives `400 VALIDATION_ERROR`.
  - The period start (`since`) is computed exactly as in `orders_insights`. Reuse its date logic,
    `_ORDER_CREATED_TZ` and `DELIVERED_DAY_CTE`, so each list matches its card by construction.
  - Row sets per metric:
    - `ordered`: `deleted_at IS NULL AND status <> 'cancelled' AND created >= since`. Order by
      created_at DESC, id DESC.
    - `cancelled`: same filter, but `status = 'cancelled'`.
    - `delivered` and `average_check`: the `eligible` rows with `delivered_at >= since`. Order by
      delivered_at DESC, id DESC.
    - `profit`: the same rows, ordered by profit ASC, id ASC.
    - Every order row includes `order_id` (public id or `legacy_N`), `order_reference`,
      `customer_name`, `status`, `created_at`, `delivered_at` (delivered metrics only),
      `created_by_staff_account_id`, `sales`, `base`, `profit`, `delivery_courier_amount` and
      `delivery_owner_amount`. `sales` and `base` use the same formulas as `orders_insights`.
    - `clients`: one row per `phone_normalized` with a non-cancelled order created in the period.
      Each row has the latest `customer_name`, `phone`, `orders_in_period`, `first_order_at` and
      `is_new` (`first_at >= since`). Order by `first_order_at` DESC, phone ASC.
  - Every response also carries a `summary` over **all** rows, not only the current page.
    - Order metrics: `count`, `sum` (sales for delivered metrics, order_total otherwise) and
      `profit`.
    - `clients`: `new_clients` and `returning_clients`.
  - Pagination is keyset (`_encode_cursor`/`_decode_cursor`) with a deterministic tiebreaker. The
    route goes in the admin router before any generic `orders/{id}` matching.
- **Next.js:**
  - `src/lib/api-v1/admin-server.ts`: add `getAdminOrdersInsightsDrilldown(days, metric, cursor)`.
  - `src/lib/api-v1/admin-types.ts`: add its types.
  - `src/app/admin/orders/page.tsx`: accept `drill=<metric>` (validated against the allow-list;
    an unknown value is ignored) and fetch it in parallel with the existing reads.
  - `OverviewSections.tsx`:
    - Each `KpiGrid` card becomes a `Link` to `?view=overview&days=…&drill=<metric>#drill`, with
      `aria-current` on the open card.
    - New hints:
      - «Заказали»: «созданы за период, кроме отменённых»
      - «Доставлено»: «по дате доставки»
      - «Средний чек»: keep «по доставленным»
      - «Прибыль с товаров»: keep the formula
    - A new `DrillPanel` section with `id="drill"` shows:
      - the title, the explanation line and the summary;
      - a table with links to `/admin/orders/{order_id}`;
      - negative profit highlighted;
      - «Следующая страница →» and «Закрыть».
  - `FinanceView.tsx`: add «В среднем за день» to the courier card, with the hint «за N дней с
    доставками».
  - `orders-ui.css`: card hover and focus styles, and the drill panel styles.
- **Pure helpers** go in a new file with no `@/` imports and no Next.js imports, for example
  `src/app/admin/orders/insights-metrics.ts`:
  - `DRILL_METRICS`;
  - `parseDrillMetric(value)`;
  - `drillExplanation(metric)`, which returns the Russian copy;
  - `courierAveragePerDay(daily)`, which returns `{ average, workingDays }` using decimal-safe
    rounding to 0.01.
- `API_CONTRACT.md` §8.1.3: document the new route, its parameters, the per-metric definitions
  and the response shape.
- `package.json`: add the new frontend test to `test:frontend`.
- **Out of scope:**
  - Repeat medicines. This is **follow-up job 008**: add a `repeat_medicines` aggregate (medicines
    in ≥ 2 distinct non-cancelled orders in the period) to insights, plus a card. The owner should
    confirm the meaning first.
  - Changing how profit is computed, or "fixing" the −105.
  - Any change to `orders_insights`'s existing response, `dashboard_summary`, `courier_earnings`
    or the staff routes.
  - Mutations, migrations, `db/migrations`, `backend/local-agent/agent.py`, API Gateway config and
    new dependencies.

## Acceptance criteria
1. Card totals match their drill-down summary, given the same mocked rows: `ordered` count/sum
   equals `ordered_count`/`ordered_sum`; `cancelled` count equals `cancelled_count`; `delivered`
   count/sum equals `delivered_count`/`delivered_sum`; `profit` summary equals `totals.profit`;
   `clients` summary equals `clients`. The SQL for each metric uses the same filter and period
   start as `orders_insights` (checked in unit tests via the executed SQL and params).
2. `GET /v1/admin/orders/insights/orders` returns `400 VALIDATION_ERROR` in these cases:
   - unknown parameters;
   - `days` not in {1, 7, 30, 90};
   - an unknown `metric`;
   - `limit` > 100 or < 1;
   - a malformed cursor.

   All SQL values are passed as parameters; `metric` only selects from fixed SQL fragments. It is
   reachable only through the admin auth path, like `orders/insights`. It returns
   `has_more`/`next_cursor` with stable keyset ordering, and the `profit` metric lists the lowest
   profit first.
3. Each of the six cards on `/admin/orders?view=overview` is a keyboard-focusable link. Opening one
   renders the `#drill` panel with that metric's list for the current period. The period tabs
   keep `drill`. «Закрыть» removes it. An unknown `drill` value renders the overview without a
   panel and without an error.
4. In the profit drill-down, every row shows «Сумма», «Цена аптеки» and «Прибыль». Rows with
   negative profit are visually marked. The panel shows the summary profit, which equals the
   card value. Each row links to the order page.
5. The «Заказали» and «Доставлено» cards show the hints from Scope. Each drill panel shows
   `drillExplanation(metric)`. All new copy is Russian.
6. The «Финансы» courier card shows «В среднем за день» =
   `courierAveragePerDay(insights.daily).average`, with the hint «за N дней с доставками». If
   there are 0 working days it shows `0 с.` and no division error.
7. `npm run lint`, `npm run build`, `npm run test:frontend` and
   `python -m unittest discover backend/tests` all pass.

## Tests
- Extend `backend/tests/test_orders_insights.py`, or add `backend/tests/test_orders_insights_drilldown.py`,
  using the existing `fake_transaction` / `Mock` cursor pattern:
  - The SQL and params for each metric. For example, `ordered` contains `status <> 'cancelled'`
    and uses the creation time; `delivered` uses `DELIVERED_DAY_CTE` and `delivered_at >= %s`;
    `profit` orders by profit ascending.
  - Summary values, row mapping (`legacy_N`, ISO times) and `profit = sales − base`, including a
    negative case.
  - Validation errors (criterion 2) and the cursor round-trip / `has_more`.
  - A routing test in the style of `test_admin_contract.py`, checking that
    `GET /v1/admin/orders/insights/orders` dispatches to the new function and not to `get_order`.
- Add `tests/orders-insights-metrics.test.ts` (`node --test`, relative import only):
  - `parseDrillMetric` returns the allow-listed values and `null` for anything else.
  - `drillExplanation` returns non-empty Russian text for every metric.
  - `courierAveragePerDay`: mixed days, all-zero days, and string decimals such as `"12.50"`.
- Criteria 3–5 are checked manually against `npm run dev` with a mocked or staging upstream, or by
  code review. The builder records in `build.md` exactly what was run.

## Risks
- **Needs a Lambda deploy.** The drill-down is a new admin Lambda route. Until the admin Lambda is
  redeployed, the Vercel build would call a route that does not exist yet. The page must
  degrade: if the drill request fails, show a Russian error inside the panel
  («Не удалось загрузить список. Попробуйте обновить страницу.») and keep the rest of the
  overview working. Deploy the Lambda before or together with Vercel. The approver must escalate
  the deploy. It is covered by the existing `ANY /v1/admin/{proxy+}`, so no API Gateway change is
  needed.
- **No migration expected.** All columns exist (`orders`, `order_items`, `order_status_history`).
  If the builder finds that a missing index makes the `profit`-ordered keyset query slow at
  90 days, it must report that rather than add a migration.
- **Definitions must not drift.** If the drill-down filters differ from `orders_insights`, the list
  will not add up to the card, which defeats the purpose. Share the SQL fragments and constants.
  Do not copy-edit them.
- **Profit semantics.** `base_unit_price` NULL counts as 0, which inflates profit. Negative profit
  comes from lines where pharmacy price × qty > line_total. This job only exposes the data. It
  does not change the formula.
- **Security.**
  - Admin-only. Next.js calls `requireAdminSession()`, and the Lambda admin path checks auth.
  - `metric` must map to fixed SQL; never interpolate it.
  - The clients list shows phone numbers, which admins already see in «Рабочие заказы». Do not
    log them.
- **Russian copy.** All labels, hints and errors are Russian. Money uses the existing `money()`
  format (`с.`).
- **Scope split.** Repeat medicines are deferred to job 008, and the owner should confirm its
  meaning first. The placement of the courier average (Финансы rather than Обзор) is an
  interpretation and needs owner confirmation.
- Windows 7 agent: unaffected. `backend/local-agent/agent.py` is not touched.

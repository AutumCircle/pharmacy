VERDICT: PASS

Security review: 007-orders-overview-drilldown, round 1 (diff `main...factory/007-orders-overview-drilldown`, commit a02930d).

## Findings
None blocking.

- Boundary: the SQL is only in `backend/v1/admin_api/lambda_function.py`. Next.js calls the Lambda through `src/lib/api-v1/admin-server.ts`, which starts with `import 'server-only'`. The new code adds no DB access in the frontend and no client components that fetch data.
- Secrets: the diff has no `.env*` files, credentials or `NEXT_PUBLIC_*` additions.
- AuthZ:
  - The route `GET /v1/admin/orders/insights/orders` (lambda_function.py ~4328) is dispatched after `require_admin_identity(event)`. It is reachable only through the admin path, the same as `orders/insights`. A test also checks for a 403 without the authorizer.
  - The page calls `requireAdminSession()` before any fetch (`src/app/admin/orders/page.tsx:523`).
  - The route is placed before the generic `orders/{id}` match.
- Input / SQL:
  - `metric` is checked against `_DRILL_METRICS` and only selects from fixed dicts of SQL (`_DRILL_CREATED_ROWS`, `_DRILL_ORDERING`, `_DRILL_SUMMARY_COLUMNS`).
  - All values (`since`, the cursor values, `limit`) are bound as `%s` params.
  - Unknown keys, `days`, and `limit` (1..`MAX_LIMIT`=100) are all validated.
  - `_drill_cursor` checks the exact key set, an int id > 0, string length ≤ 64, a finite Decimal, an aware datetime, and that the time is not before `since`. Any failure gives `VALIDATION_ERROR`, not a 500.
- Abuse:
  - Queries are bounded by the period (max 90 days) and paginated (`LIMIT limit+1`, max 100).
  - The endpoint is read-only. It adds no destructive endpoints, SSRF, redirects or `dangerouslySetInnerHTML`.
  - Order links use `encodeURIComponent(order.order_id)`, and URL params are built with `URLSearchParams`.
  - React escapes all rendered values.
- PII: the client cursor uses `first_order_id`, not the phone, so phone numbers stay out of URLs and access logs. The new code adds no logging of phones.

## Notes (non-blocking)
- The clients list returns full phone numbers to the admin UI. This matches the existing «Рабочие заказы» exposure and is admin-only, so it is acceptable. Masking can be revisited if the overview is ever shown to non-admin staff.
- The `first_order_at` cursor for `clients` is not checked against `since` (the build notes say this is by design, because first orders can predate the period). It is still parsed strictly and bound as a param, so there is no risk.
- The `profit`-ordered keyset recomputes the delivered set for each page. Cost is bounded by the 90-day cap and admin-only access, so this is not a DoS concern at current volume.

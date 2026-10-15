VERDICT: PASS

Security review, job 001-courier-delivery-checklist, round 1 (diff `main...factory/001-courier-delivery-checklist`, commit a41f503).

## Findings
None blocking.

- Boundary: SQL for `order_courier_checklist` is only in `backend/v1/admin_api/lambda_function.py` and the migration. The Next.js route `src/app/api/staff/orders/[order_id]/checklist/route.ts` only forwards through `staff-server.ts` using the server-side session cookie. `src/` has no SQL and no DB client.
- Secrets: the diff has no `.env*` files, credentials, tokens or `NEXT_PUBLIC_*` additions. The client component calls the internal `/api/staff/...` route, and the browser never gets an API key.
- AuthZ: `lambda_function.py:4015`. The PATCH checklist route calls `staff_accounts.session_account(event, courier=True)` before any work, which matches the sibling status and customer routes. `test_only_courier_can_tick_checklist` covers the 403 for the pharmacy session.
- Input: `update_courier_order_checklist` (`lambda_function.py:1687`) checks the payload before it opens the DB. It allows only the exact keys `{step, done}`, rejects bool and non-int steps, accepts steps 1-8 only, rejects the status-derived steps 3/6/8, and requires `done` to be a bool. The SQL is fully parameterized (`%s`). The only f-string fragment is the `_order_lookup` clause, which is built from constants with bound values, and `order_id` is also regex-checked in the router and in Next.js. The Lambda derives `website_order` and `cancelled` from the DB row under `FOR UPDATE`, so the client is never trusted for status, role or ownership. The step-3/6/8 state comes from `orders.status`, and the client cannot store it.
- Abuse: the read for each order is one bounded LATERAL aggregate with at most 5 rows, so there is no N+1 and the query is not unbounded. The diff has no phone lookup, redirect, SSRF or `dangerouslySetInnerHTML`. The only new link is the static in-page anchor `#courier-fee`.
- Destructive: `DELETE` is limited to a single `(order_id, step)` row, behind the courier session. No bulk or cleanup endpoint is added. The migration is additive (`CREATE TABLE IF NOT EXISTS`). `ON DELETE CASCADE` only triggers on an order hard-delete, and no new path performs one.

## Notes (non-blocking)
- `lambda_function.py:1711,1718`: `completed_by` and the audit `actor_id` are hardcoded to `"staff:3"`. This is accurate today because `courier=True` only admits account 3, and it matches the existing courier handlers. If more courier accounts are added, take the actor from the `session_account(...)` return value so the audit trail stays attributable.
- The existing staff routes have no per-route rate limit. Checklist writes are idempotent and audit only real changes, so the abuse surface is minimal.
- Deploy order still matters for availability, not security: apply 0023 before the Lambda deploy. This is already flagged in build.md.

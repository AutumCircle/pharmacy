VERDICT: PASS

Scope reviewed: `git diff main...factory/013-ordering-flow-v2` (backend/v1 admin, public, shared, telegram_notifier; Next.js `pharmacy-answers` route; `src/lib/pharmacy-answers.ts`; new client components `PharmacyRowActions.tsx`, `usePharmacyItemPost.ts`, `OrderFulfillment.tsx`).

## Findings
None blocking.

- Boundary: all new SQL is in Lambda (`backend/v1/shared/order_stage.py`, admin/public `lambda_function.py`). Next.js only proxies. The client components POST to same-origin `/api/staff/...` routes.
- Secrets: the diff has no credentials or `.env*` files. It adds no `NEXT_PUBLIC_*` variables. `sendOrderNotification` stays in `server-only` `src/lib/api-v1/server.ts` and uses `ADMIN_API_BEARER_TOKEN` on the server side.
- AuthZ: the pharmacy id comes from the HMAC staff session (`session_account(event, pharmacy=True)`). The «Ватан 1» repricing check is still in Lambda (`admin_api/lambda_function.py:~1855-1880`). It checks that the item's effective pharmacy equals the session pharmacy (403 otherwise), that the order is `pending` under `FOR UPDATE` (409), and it rejects staff-created orders (404). Admin `fulfillment` is returned only through the existing admin-authenticated `get_order`.
- Input and trust: `base_unit_price` is validated in Lambda (`validate_pharmacy_answers`). The selling price, line total and order totals are recomputed in SQL with `vatan_selling_unit_price`. Nothing uses a client-sent price total, stage or role. `assembled_sql(alias)` interpolates only a caller-fixed alias that is checked with `isidentifier()`. All values are passed as `%s` parameters.
- Notification path: `_notification` is built only from Lambda DB data and contains no customer name, phone, address, landmark or notes. `forwardChangeNotification` removes it before `NextResponse.json`, so it never reaches the browser. The browser cannot inject a notification. The claim regex (`admin_api/lambda_function.py:526`) is anchored (`fullmatch`), limits the request id to `req_[0-9a-f]{32}`, and rejects `pharmacy_telegram` for change keys. The notifier checks the key again against `admin_order_id`. The notifier HTML-escapes `medicine_name` and `order_reference`, formats quantity and prices through Decimal, and includes no client data.
- Public tracking: `stage` adds only a derived progress flag for orders already returned for that phone. The query count is unchanged (one statement plus the items statement), `LIMIT 20` still applies, and there is no new enumeration surface.
- Abuse: no `dangerouslySetInnerHTML`, redirects, user-controlled outbound URLs or destructive endpoints were added.

## Notes
- `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts:25`: the notifier call is awaited inline with an 8 s timeout, so a slow notifier delays the pharmacy's answer response by up to 8 s. This is not a security issue. Failures are already swallowed. Fire-and-forget (or `after()`) would remove the delay.
- An authenticated pharmacy can send repeated real price changes, and each one produces an owner and courier Telegram message. Each change is audited and needs a staff session, so this is acceptable. A per-order throttle could be a follow-up if it gets noisy.

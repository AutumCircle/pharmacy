VERDICT: PASS

Security review, job 008-pharmacy-order-screen, round 1 (diff `main...factory/008-pharmacy-order-screen`, commit b708050).

## Findings

None blocking.

- Boundary: SQL is only in `backend/v1/admin_api/lambda_function.py`. Next.js reads through the existing `listPharmacyPreparationOrders` server helper, and no DB access was added to `src/`.
- Secrets: no credentials, tokens or `.env*` files. No new `NEXT_PUBLIC_*` variables. `WaitingMinutes.tsx` is the only client component, and it gets only `since` (ISO time) and `initialNow`.
- AuthZ: the pharmacy scope comes from the Lambda-verified session `account_id` (`lambda_function.py:1489`, `COALESCE(o.fulfillment_pharmacy_id, 1) = %s`). A `pharmacy_id`/`account_id` query key is rejected with `VALIDATION_ERROR` (`lambda_function.py:1485`). A new test covers both, including the full handler path.
- Input/SQL: all queries are parameterized. The new `::text` casts and fields are fixed SQL expressions with no interpolated input. The f-string only inserts the constant `cursor_filter`. `limit` is capped at 50, so the query is bounded.
- Privacy: `pharmacyOrderView` (`src/lib/pharmacy-order.ts:490`) builds the card from an allowlist. The old page rendered `customer_name`, `phone`, `address`, `landmark`, `order_total`, `profit` and the creator directly. That code is removed, which shrinks exposure. Under the default `pharmacy_web` policy the Lambda still strips those fields.
- XSS/redirects: there is no `dangerouslySetInnerHTML`, and all values render as React text. Status is used in a className only after the allowlist check (`pending`/`confirmed`). The pagination link still URL-encodes the cursor, and there are no new redirects or outbound fetches (no SSRF).
- No destructive endpoints, migrations or `agent.py` changes.

## Notes (non-blocking)

- `lambda_function.py:1539-1540`: `waiting_since` and `awaiting_response` are not gated by the policy. If the owner turns off `created_at` or `status` for `pharmacy_web`, the creation time and pending/confirmed state still come through these two fields. This was a deliberate spec decision and contains no client data, so it is acceptable. The next job may want to document that these toggles do not fully hide timing/state.
- The default policy change (`order_notification_settings.py:26`) now shows pharmacy base prices to pharmacy staff by default. This is intended by the owner request and matches the Telegram pharmacy default. Client price, client total and profit stay off.
- `profit` is still computed for every row before policy stripping (this was already the case). It is removed under the default policy and the UI never renders it. No action needed.

VERDICT: PASS

Scope reviewed: `git diff main...factory/016-order-view-history` (backend `order_timeline.py`, `get_order`,
`_order_audit_rows`, `get_courier_order`, frontend admin/courier order view, types, tests, docs).

## Findings

None blocking.

- Boundary: all new SQL is in the admin Lambda (`backend/v1/admin_api/lambda_function.py`); the Next.js changes only
  render the new `timeline` field. No DB access from Next.js or the browser.
- Secrets: no credentials, tokens or `.env*` in the diff; no new `NEXT_PUBLIC_*` usage.
- AuthZ: `GET /v1/staff/orders/{id}` still requires `staff_accounts.session_account(event, courier=True)` before
  `get_courier_order` (lambda_function.py ~5084); `timeline` is added only to admin `get_order` and the courier
  detail read, not to list endpoints or pharmacy endpoints.
- Input/SQL: the new queries (status history, `_order_audit_rows` x2, courier audit read) use `%s` parameters,
  including `ANY(%s::text[])` and `LIMIT %s`. The only f-string interpolation is the module constant
  `_AUDIT_TIMELINE_COLUMNS` and the existing `_COURIER_ORDER_SELECT`/`lookup`. Order id is regex-restricted by the router.
- Data exposure: `order_timeline.py` never forwards raw `details`. `_clean` limits keys to `EVENT_KEYS`, and values
  are normalised with `_text`/`_amount`/`_int`/enum checks. `courier_view` uses a per-kind key allowlist, drops
  `customer_updated`, `item_updated`, `delivery_fee_updated`, `deleted`, `items_added` and `other`, keeps a status
  reason only for cancellations, and replaces admin identity with the generic `admin` actor. The courier SQL also
  pre-filters to `COURIER_ACTIONS`.
- Abuse: every read is capped at `TIMELINE_LIMIT + 1` (201) rows. The output is capped at 200 events. There is no
  new route, no redirect, no `dangerouslySetInnerHTML`, and no SSRF surface. The new `tel:` links
  (`OrderCustomerEditor.tsx`, `CourierOrderDetail.tsx`) use a fixed `tel:` scheme prefix, and React escapes the
  text, so phone data cannot inject a `javascript:` URL.
- No destructive endpoints were added.

## Notes

- `backend/v1/admin_api/lambda_function.py` `_order_audit_rows`: the fallback
  `reference = str(order.get("order_reference") or order.get("public_id") or order["id"])` can fall back to a bare
  internal integer. That integer could match `details->>'reference'` from an unrelated order's removed item written
  later. The result is visible only to admins, who can already read every order, so this is a correctness issue,
  not a security one. Consider dropping the bare-`id` fallback (use `legacy_N`), or skip the second read when there
  is no reference.
- The courier timeline keeps pharmacy base prices in `pharmacy_price_changed` (`previous_price`/`new_price`). This
  matches the spec and the existing courier projection, which already exposes `base_unit_price`. Revisit if
  pharmacy cost prices should ever be hidden from the courier.
- The removed-item JSONB match is unindexed. It is bounded by `resource_type`, `created_at >= orders.created_at` and
  `LIMIT`, but over time it scans every `order_item` audit row written after the order was created. Watch latency
  on old orders (see the spec's risk note).

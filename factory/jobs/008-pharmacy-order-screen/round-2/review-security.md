VERDICT: PASS

Security review, job 008-pharmacy-order-screen, round 2 (diff `main...factory/008-pharmacy-order-screen`, commits b708050 + d8b7133).

## Findings

None blocking.

- Boundary: SQL lives only in `backend/v1/admin_api/lambda_function.py`. Round 2 changes only frontend files, tests and the API contract. No DB access was added to `src/`.
- Secrets: no credentials, tokens or `.env*` files. No new `NEXT_PUBLIC_*` variables. `WaitingMinutes.tsx` is still the only client component, and it gets only `since` and `initialNow`. Client identity is rendered by the server component `PharmacyOrderCard.tsx`, so it is not serialized as client props.
- AuthZ: the pharmacy scope still comes from the Lambda-verified session (`lambda_function.py:1483-1520`, `COALESCE(o.fulfillment_pharmacy_id, 1) = %s` with the session `pharmacy_id`). Unknown query keys raise `VALIDATION_ERROR`. Field visibility is enforced in the Lambda by the `pharmacy_web` policy (`lambda_function.py:1548-1564`). Round 2 removed the frontend allowlist, as the owner asked in `rework-1.md` ("if i turn them on they should show it"). This does not weaken authorization: the UI renders only what the Lambda already allowed, and the Lambda defaults keep `customer_name`, `phone`, `address`, `landmark`, `order_total`, `line_total`, `profit` and `creator` OFF. A new backend test covers the ON case.
- Input/SQL: parameterized. The f-string inserts only the constant `cursor_filter`. `limit` is capped at 50. Money comes from SQL as strings and the UI does not recompute it.
- XSS/injection: there is no `dangerouslySetInnerHTML`. All values render as React text. The `tel:` href (`PharmacyOrderCard.tsx:47`) is reduced to `[\d+]` before use, so a stored phone value cannot inject a `javascript:` or other scheme. Status reaches a className only after the `pending`/`confirmed` allowlist in `pharmacyOrderView`.
- Abuse: no new endpoints, redirects or outbound fetches (no SSRF). The pagination link still URL-encodes the cursor, and the page caps the cursor length at 500.
- No destructive endpoints, no migrations and no changes to `agent.py`.

## Notes (non-blocking)

- Carried over from round 1: `waiting_since` and `awaiting_response` (`lambda_function.py:1539-1540`) are not policy-gated. If the owner turns off `created_at`/`status` for `pharmacy_web`, these two fields still reveal the creation time and pending/confirmed state. The spec chose this on purpose, and the fields contain no client data.
- Showing client PII on the pharmacy screen now depends only on the owner's admin setting. That is the owner's decision. The approver may want to tell the owner that turning on phone/address for "Аптека · веб-панель" exposes them to both pharmacy accounts' web sessions.

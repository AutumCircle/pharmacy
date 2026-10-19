VERDICT: PASS

Security review: job 011-pharmacy-assembly-marks, round 1 (diff `main...factory/011-pharmacy-assembly-marks`).

## Findings
None blocking.

Checked:
- **Boundary.** All new SQL is in `backend/v1/admin_api/lambda_function.py`. The Next.js route `src/app/api/staff/orders/[order_id]/assembly/route.ts` only reads the httpOnly staff cookie, pre-validates and proxies through the `server-only` `staff-server.ts`. Browser code (`PharmacyAssemblyButtons.tsx`) calls only the same-origin `/api/staff/...` route. No DB access from Next.js or the browser.
- **Secrets.** The diff has no credentials, tokens, `.env*` or new `NEXT_PUBLIC_*` values.
- **AuthZ.** In `lambda_handler` (lambda_function.py ~4587), `session_account(pharmacy=True)` does HMAC verification, checks the credential version and limits accounts to 1/2, so a courier gets 403. The pharmacy id comes only from the session. The body allowlist `set(payload) == {"state"}` rejects `pharmacy_id`. `mark_pharmacy_assembly` also checks `pharmacy_id in (1, 2)` as defence in depth.
- **Ownership.** The order row is locked `FOR UPDATE`. The ownership check (`assigned_count`, the effective item pharmacy equals the session pharmacy) runs before the status check, so the 404 and 409 responses do not leak the status of another pharmacy's order. Non-website and deleted orders give 404.
- **Input / SQL.** All values are `%s` parameters. The only f-string pieces are server constants (`_ITEM_PHARMACY_SQL`, `_COURIER_ORDER_PHARMACY_SQL`) and `_order_lookup`, which emits a fixed fragment. The path regex limits `order_id` to `ord_[0-9a-f]{32}|legacy_[1-9][0-9]*` in both Next and Lambda. `state` is allowlisted against `ASSEMBLY_STATES`, and the forward-only transition set is enforced server-side. The DB CHECK constraints in 0025 back this up. The client cannot set status, totals, timestamps or the pharmacy.
- **Audit.** Details are only `{pharmacy_id, from_state, to_state}`, with actor `staff:N`. No PII. No-op repeats write nothing.
- **Data exposure.** `assembly_state` and `assembly_available` in the pharmacy queue hold no client data, so leaving them outside the `pharmacy_web` policy is acceptable. The courier `assembly` list carries only pharmacy id, state and timestamps.
- **Abuse.** No new unbounded queries: the assembly LATERAL is per order inside the existing paged list (limit ≤ 50). No `dangerouslySetInnerHTML`, redirects, outbound fetches (SSRF) or destructive endpoints. The migration is additive (`CREATE TABLE IF NOT EXISTS`, FK `ON DELETE CASCADE` only to `orders`), with no DROP, UPDATE or DELETE.

## Notes
- The new POST endpoint has no rate limit. It is behind an authenticated pharmacy session, writes at most two state changes per (order, pharmacy) and is idempotent afterwards, so abuse potential is negligible. This matches the other staff endpoints.
- The Next route returns 401 only when the cookie is missing. Lambda does the real session check. This is the existing pattern.
- There is no undo, and admin edits after `confirmed` do not reset marks (spec Risks). This is an integrity/UX concern, not a security issue.

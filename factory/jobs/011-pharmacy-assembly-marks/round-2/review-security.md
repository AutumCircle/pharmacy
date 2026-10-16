VERDICT: PASS

Security review: job 011-pharmacy-assembly-marks, round 2 (rework 1). I reviewed the full diff `main...factory/011-pharmacy-assembly-marks` and looked closely at the rework commits `9922f27` and `f765d5e`.

## Findings
None blocking.

Checked in the rework:
- **Boundary.** All new SQL is in `backend/v1/admin_api/lambda_function.py`. That covers `collect_pharmacy_order_item`, `_sync_item_assembly`, `_reprice_items_from_base`, `_require_assembly_complete` and the auto-answer insert in `mark_pharmacy_assembly`. The new Next route `src/app/api/staff/orders/[order_id]/assembly/items/route.ts` does three things: it reads the httpOnly staff cookie, pre-validates `order_id` against a regex and the body against `validateItemCollectRequest`, and proxies through the `server-only` `staff-server.ts`. The browser calls only same-origin `/api/staff/...`.
- **Secrets.** The diff adds no credentials, `.env*` files or `NEXT_PUBLIC_*` values.
- **AuthZ, item «Собрано»** (lambda_function.py ~4819, ~1965). `session_account(pharmacy=True)` is checked. The pharmacy id comes from the session only. The body is exactly `{"order_item_id": int}`. The order is locked `FOR UPDATE` and the item `FOR UPDATE OF oi`. The checks run in this order: website order (404), item in order (404), effective item pharmacy equals the session pharmacy (403), then status in `pending|confirmed` (409), then the item is answered `available` by this pharmacy (409). Because ownership is checked before status, no state of another pharmacy's item leaks.
- **AuthZ, pharmacy price** (~1824-1846). `base_unit_price` is accepted only with `answer == "available"`. The value goes through the existing `validate_unit_price`. A price from any session other than pharmacy 2 gets 403. A price change on an item that is not effectively assigned to the session pharmacy is "not same", so it hits the existing 403. Answers still require `status == 'pending'`. The client price is never trusted. `_reprice_items_from_base` recomputes `selling_unit_price` and `line_total` in SQL with `vatan_selling_unit_price(%s)`. Order totals are re-summed from `line_total`, the same way as the admin base-price edit (~3185). An audit row records previous and new prices without PII. The answers upsert JSON is filtered back to `order_item_id/answer/problem`, so the price does not leak into `problem`.
- **«Согласовано» gate** (~2269). `_require_assembly_complete` is enforced server-side in `update_courier_order_status`, not only in the UI. It is skipped for courier-created orders, as the spec says.
- **Auto «В наличии» on «Сборка сделана»** (~2123). It touches only items effectively assigned to the session pharmacy with no existing answer (`ON CONFLICT DO NOTHING`), only while the order is `pending`, and it is audited.
- **Input / SQL.** All values are `%s` parameters. The f-string pieces are server constants only (`_ITEM_PHARMACY_SQL`, `_order_lookup`). `params` grew from 6 to 7 to match the added `%s` in the queue query, and the placeholder count matches.
- **Data exposure.** The new `routed_away` in the pharmacy queue carries item id, medicine name, quantity (only under `policy["quantity"]`), pharmacy id and answer. No client data is included, and it is gated by `policy["items"]`.
- **Abuse.** The new LATERALs and `json_agg` run per order inside the existing paged list (limit ≤ 50). No `dangerouslySetInnerHTML`, redirects, SSRF or destructive endpoints. Migration 0025 is additive only (`CREATE TABLE IF NOT EXISTS order_item_assembly`, FK `ON DELETE CASCADE` to `order_items`, CHECK `pharmacy_id IN (1,2)`).

## Notes
- «Ватан 2» can now raise the customer total. Its price is bounded only by `validate_unit_price` (up to 999999.99), with no limit relative to the original price. This is the owner's request from rework-1 and it is audited (`pharmacy.order.item_price_changed`). Optionally, cap the change (for example to a multiple of the previous base price) or show the courier that the price was changed by the pharmacy.
- The new `POST .../assembly/items` has no rate limit. It is behind an authenticated pharmacy session and is idempotent per item, which matches the other staff endpoints.
- A price change on an item that is already collected does not reset its «Собрано» mark. This is an integrity/UX question, not a security issue.

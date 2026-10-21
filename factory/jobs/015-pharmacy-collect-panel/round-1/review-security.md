VERDICT: PASS

Security review of `git diff main...factory/015-pharmacy-collect-panel` (round 1). I found no blocking issues.

## Checked
- **Boundary.** All SQL is still in `backend/v1/admin_api/lambda_function.py`. The Next.js `assembly/route.ts` only calls `markPharmacyAssembly` and `sendOrderNotification`. `sendOrderNotification` is in `src/lib/api-v1/server.ts` (`import 'server-only'`) and uses `ADMIN_API_BEARER_TOKEN` on the server side. No DB access or secrets were added to browser code.
- **Secrets.** The diff has no credentials, tokens, `.env*` files or `NEXT_PUBLIC_*` additions.
- **AuthZ.**
  - `mark_pharmacy_assembly` still takes `pharmacy_id` from the staff session only. It still rejects anything other than 1 or 2 with 403. The body is exactly `{state}` (`validate_assembly_request`).
  - The new 409 in `answer_pharmacy_order_items` (lambda_function.py:1869-1874) runs after `SELECT … FOR UPDATE` on the order. It is parameterized and keyed to the session pharmacy.
  - Completion detection (`_order_assembled_notification`) runs in the same transaction under the order lock. Two concurrent «Собран» presses are serialized, so at most one notification is produced per completion.
- **Notification leak.**
  - `assembly/route.ts:27-32` strips `_notification` with `splitChangeNotification` before `NextResponse.json`, so it never reaches the browser.
  - The payload carries only the medicine name, quantity, reference, ids and `client_total`. It has no name, phone, address, landmark or notes.
- **Claim endpoint.**
  - The regex at lambda_function.py:529 is anchored (`fullmatch`) and needs exactly 32 hex characters. The event key fits `VARCHAR(100)`.
  - Non-`created` keys are limited to `owner_telegram` and `courier_telegram`.
  - The courier claim still honours `courier_enabled` and `courier_enabled_since`. Dedup is `ON CONFLICT DO NOTHING`.
  - The `request_id` in the key is server-generated (`req_{uuid4().hex}`, `backend/v1/shared/responses.py:23`), not taken from the client.
- **Notifier.**
  - `format_order_assembled_message` HTML-escapes `order_reference` and `medicine_name`.
  - The text is capped at 3800 characters.
  - `_owner_courier_event_key` binds the event key to the numeric order id and the kind, and raises on a mismatch.
  - The pharmacy is never a recipient. The courier gets only the «📦 Открыть заказ» button.
- **Input trust.** The client sends only `{state: 'assembled'}`. «Not marked = available» and the totals are computed server-side. The UI hiding of controls is backed by the Lambda 409.
- **Abuse.** No new enumeration surface, unbounded query, SSRF, `dangerouslySetInnerHTML`, redirect or destructive endpoint was added. The items query in `_order_assembled_notification` is limited to one order.

## Notes (non-blocking)
- `collect_pharmacy_order_item` (lambda_function.py:2120, the `assembly/items` endpoint, which the spec keeps) has no «read-only after Собран» check. A pharmacy can still call it after «Собран».
  - It can only add a «collected» mark to an item it already answered «В наличии», so it cannot falsify the courier message. It is low risk.
  - For consistency, consider adding the same `ASSEMBLY_STATE_CONFLICT` guard, or retiring the route in a later job.
- Build open question 3: a part can become complete through «Нет в наличии» or `_sync_item_assembly` without a «Собран» press. In that case no «Заказ собран» message is sent. This is functional, not a security issue.

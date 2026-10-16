VERDICT: PASS

Security review, job 010-pharmacist-actions-routing, round 1. Diff `main...factory/010-pharmacist-actions-routing`.

## Findings (blocking)

None.

## What was checked

- **Boundary.** All SQL is in `backend/v1/admin_api/lambda_function.py`. The new Next.js route
  `src/app/api/staff/orders/[order_id]/pharmacy-answers/route.ts` only pre-validates and forwards through
  `staff-server.ts` (`server-only`, HMAC service header). `PharmacyAnswerForm.tsx` calls only the
  same-origin `/api/staff/...` route. No DB access from Next.js or browser code.
- **Secrets.** There are no credentials, tokens, `.env*` or new `NEXT_PUBLIC_*` values in the diff. The staff
  session cookie is read on the server only.
- **AuthZ.** `lambda_function.py` (handler, `answers_match`) calls
  `staff_accounts.session_account(event, pharmacy=True)` after `require_service`. That call rejects
  account 3 and any non-1/2 account with 403. `answer_pharmacy_order_items` takes `pharmacy_id`
  only from the session and checks it again. Item ownership is checked against
  `COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)` after the order is read `FOR UPDATE` and the items
  are read `FOR UPDATE OF oi`. Courier-created orders give 404, and orders with no own item give 404
  before the status check, so a pharmacy cannot use 409 to learn whether another pharmacy's order exists.
  `src/proxy.ts` is not relied on.
- **Input.** Body keys are exact (`{"answers"}`). Entry keys are limited to
  `order_item_id/answer/problem`, so price and `pharmacy_id` keys give 400. `order_item_id` must be a
  strict int in the bigint range. Answers come from an enum. Problem text is whitespace-normalized,
  NUL is rejected and the length is 3..300, which the DB CHECK 1..300 backs. There are at most 50
  entries and no duplicates. All SQL is parameterized: `jsonb_to_recordset(%s::jsonb)`,
  `ANY(%s)`, and the f-string fragments are server constants only. Routing (`fulfillment_pharmacy_id = 2`) and
  `confirmed_total` are computed on the server. No client price, total, status or role is accepted.
- **Audit.** One row per change. `details` holds only pharmacy id, item ids, answers and routed ids,
  with no problem text and no client PII. `orders.status` and `order_status_history` are not touched.
- **Abuse.** Endpoints are staff-session only and the work is bounded (≤ 50 items; list `limit ≤ 50`;
  per-order LATERAL aggregates). There is no new public endpoint and no phone lookup. The diff adds no
  `dangerouslySetInnerHTML`, and problem text is rendered as React text. No redirects. The order id in the
  route and the Lambda regex is constrained (`ord_[0-9a-f]{32}|legacy_N`) and passed through
  `encodeURIComponent`. No SSRF.
- **Destructive operations.** The only new `DELETE` is `_invalidate_pharmacy_answers`. It is scoped to
  `order_id` + item ids + the item's current pharmacy and runs inside existing admin/courier edit paths
  that are already authorized. No bulk delete or cleanup endpoint is added. Migration 0024 is
  additive (`IF NOT EXISTS`, guarded CHECK, `BEGIN/COMMIT`). Its dynamic `EXECUTE format(... %s ...)` takes
  the type name from `pg_attribute`, not from input.

## Notes (non-blocking)

- **Data exposure to «Ватан 2» (owner decision, already in the spec Risks).** `list_pharmacy_preparation_orders`
  applies the single `pharmacy_web` policy to both pharmacies. Once items are routed, «Ватан 2» will see
  whatever client fields (phone, address, totals) that policy enables for «Ватан 1». The approver should
  confirm this with the owner before deploy.
- **Problem text visible to the courier.** `answers[].problem` is free text from the pharmacist and is
  shown to the courier. It is escaped by React and is staff-to-staff only. No action is needed, but it should
  not be copied into customer-facing views in later jobs without review.
- **Over-invalidation edge.** `update_order_item_price` (`previous_base is None` branch) clears the answer
  when `base_unit_price` was NULL, even if the new base equals the legacy `price`. This is safe: it only
  forces a re-answer. It is not a security issue.
- **Rate limiting.** There is no per-account rate limit on `POST .../pharmacy-answers`. This is acceptable
  because the endpoint is authenticated, bounded and idempotent (repeats write nothing). It is the same as
  the other staff endpoints.

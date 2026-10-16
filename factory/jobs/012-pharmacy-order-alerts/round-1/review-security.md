VERDICT: PASS

Security review: job 012-pharmacy-order-alerts, round 1 (diff `main...factory/012-pharmacy-order-alerts`, commit 88d2bdd).

## Findings
None of them block.

- **Boundary.** The only SQL change is in `backend/v1/admin_api/lambda_function.py:1606,1623-1625`: one extra
  `COUNT(*) FILTER (...)` inside the existing items LATERAL. It adds no new statement, no new parameter and no writes.
  The frontend gets the data only through the existing `GET /api/staff/orders` route handler, which uses the
  server-side session cookie. Nothing in Next.js or the browser touches the database.
- **Secrets.** The diff has no credentials, `.env*` files, tokens or `NEXT_PUBLIC_*` additions. VAPID is deferred
  to 012b, and the spec already says only the public key may be public.
- **AuthZ.** `pharmacy_id` still comes from the Lambda staff session (existing path), and the extra aggregate joins
  `col.pharmacy_id = %s`, which is that same session-bound value. `needs_attention` / `attention_since` are derived
  only from this pharmacy's own answers, marks and assignment times, so they reveal nothing about other pharmacies
  beyond what `routed_away` already exposes. The client uses them only to decide when to alert. They do not drive
  any server action.
- **Input / trust.** The new code sends no new payloads. `loadQueue` (`src/components/PharmacyOrderAlerts.tsx:289-300`)
  checks the response shape, and `alertText` reads only `order_reference` / `order_id` / `attention_since`.
- **XSS / privacy.** Toast, title and `Notification` text are rendered as React text or plain strings, and none of
  them use `dangerouslySetInnerHTML`. The text holds only the reference and the minutes, so it carries no
  policy-gated PII (`src/lib/pharmacy-alerts.ts:571-578`, covered by tests). The toast links to the fixed
  `/staff/orders`, so there is no open redirect.
- **Abuse / load.** Polling runs every 30 s per open pharmacy tab against the existing paginated query
  (`LIMIT limit+1`, first page). A `busy` guard prevents overlapping polls. The poll stops on unmount. The query
  is bounded and opens no SSRF or enumeration surface.
- **Destructive endpoints.** None were added.

## Notes
- `src/components/PharmacyOrderAlerts.tsx:292`: the poll re-fetches the full queue payload, including any client
  fields the owner enabled in `pharmacy_web`, every 30 s, even though only the alert keys are used. This exposes
  no more than the page already shows. A future slimmer `?fields=alerts` view would reduce data in transit and
  in the browser cache (`cache: 'no-store'` is already set). Not required.
- 012b (Web Push): keep the VAPID private key in Lambda env/Secrets Manager only. Bind push subscriptions to the
  staff session server-side (never trust a client-supplied account/pharmacy id), and keep the payload to
  reference and minutes only, as here.

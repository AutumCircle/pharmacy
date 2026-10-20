VERDICT: PASS

Security review, job 014-pharmacy-alerts-format, round 1 (diff `main...factory/014-pharmacy-alerts-format`).

## Findings
No blocking issues.

- **Boundary.** All new SQL is in `backend/v1/admin_api/lambda_function.py`: the reopen CTE in `_reopen_pharmacy_two_assembly` (~L1951) and the settings write (~L506). The frontend changes only call existing `/api/staff/*` and admin server actions. Next.js and browser code get no DB access.
- **Secrets.** The diff adds no `.env*`, credentials or tokens, and no new `NEXT_PUBLIC_*` or `API_KEY` usage.
- **AuthZ.**
  - Settings GET, PATCH and preview sit after `require_admin_identity(event)` in the Lambda router (~L5035–5052).
  - The server actions still call `requireAdminSession()` (`src/app/admin/order-notifications/actions.ts:10,22`).
  - Pharmacies read `alarm` only inside their existing session-scoped queue (`list_pharmacy_preparation_orders`, ~L1671). This adds no new endpoint.
  - `answer_pharmacy_order_items` still takes `pharmacy_id` from the session. The reopen runs only on the `pharmacy_id == 1` routing path, so the hard-coded `'staff:1'` actor is accurate.
- **Input.**
  - The reopen SQL is parameterized. The audit `details` is built server-side with `json.dumps`, and `routed` holds only item ids the Lambda has already checked.
  - `validate_update` / `_valid_alarm` (`backend/v1/shared/order_notification_settings.py` ~L190–242) check:
    - the exact key set;
    - the ringtone against an allowlist;
    - `type(...) is int`, which rejects bool;
    - the bounds, and duration ≤ interval.
  - On read, `pharmacy_alarm_from` falls back to the defaults for invalid stored values. `stored_policies` writes only the known channels plus the alarm, so unknown keys cannot persist.
  - The inline price edit still posts only `{order_item_id, answer, base_unit_price}` through `pharmacy-answers`. The Lambda recomputes client prices and totals.
- **Abuse / XSS.**
  - No `dangerouslySetInnerHTML`, redirects or outbound fetches were added.
  - The new notifier line (`unavailable_both`) is a static string. Item names still go through the existing `html.escape` path.
  - The system `Notification` text comes from `alertText` / `systemNotification`, which carry no client data.
  - The queue keeps its existing limit, and no unbounded queries were added.
- **Destructive endpoints.** None added. The reopen only changes `assembled` to `assembling` for pharmacy 2 of the same order, in the same transaction, with an audit row.

## Notes
- The Telegram `_notification` for `unavailable_both` sends only the medicine name and quantity, which keeps the job 013 no-client-data rule. No change needed.
- Rollout: until Vercel is deployed after the new admin Lambda, the old admin page cannot save or preview, because `pharmacy_alarm` is now required. This is an availability issue, not a security one, and it is already documented in the rollout doc.

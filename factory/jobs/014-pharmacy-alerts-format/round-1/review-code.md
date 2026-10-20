VERDICT: PASS

## Commands run (in .factory-worktrees/014-pharmacy-alerts-format)
- `npm run test:frontend` -> 173 pass, 0 fail.
- `npm run lint` -> clean.
- `python3 -m unittest discover -s backend/tests -t .` -> 417 tests, 1 failure + 2 errors, all pre-existing:
  test_banner_title_can_be_empty_for_image_only_banner, test_quantity_on_delivered_order_recalculates_total_and_audits,
  test_has_more_and_cursor_round_trip_for_delivered. No new failures.
- Builder's claim verified: on main (repo root), `python3 -m unittest backend.tests.test_orders_insights_drilldown`
  also errors on test_has_more_and_cursor_round_trip_for_delivered (not touched by this branch). Claim is true.
- `backend.tests.test_staff_accounts` alone: 55 OK.

## Review
- Backend reopen of Vatan 2 assembly runs on the same cursor/transaction as the routing UPDATE, only for state='assembled',
  audit only when a row was reopened (CTE). Column `updated_by` exists (used by other inserts). Correct.
- pharmacy_alarm stored in the policies JSONB; validation strict (type(...) is int rejects bool, bounds, duration<=interval,
  exact keys); effective_settings iterates CHANNELS only, falls back to defaults. Audit has previous/current alarm.
- `unavailable_both` flows through _notification and the notifier; no client data.
- Queue returns `alarm` with no extra query. Frontend falls back to defaults on missing alarm.
- PharmacyOrderAlerts: always-on, auto-resume, unlock on first touch, Notification on every due alert, new alarm replaces the old.
- New tests are already in test:frontend; no new dependencies; old PharmacyRowActions/RoutedItems removed (no dead code).

## Notes (non-blocking)
- Manual check in installed Edge/Chrome (sound without tap) and admin page in a browser not done; leave to approver.
- If the AudioContext is still locked when an alert comes due, the alarm for that cycle is skipped (resumes on the next due cycle); acceptable given the OS notification still fires.
- `_reopen_pharmacy_two_assembly` hardcodes `updated_by='staff:1'` / audit actor 'staff:1' (the routing actor, since only Vatan 1 routes); fine, but worth a comment if the actor ever varies.

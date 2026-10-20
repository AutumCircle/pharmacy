# Build notes — 014-pharmacy-alerts-format

## Round 1
- Commits (branch `factory/014-pharmacy-alerts-format`, worktree `.factory-worktrees/014-pharmacy-alerts-format`):
  - 9856fa7 Reproduce the stale «Ватан 2» assembled mark after routing (failing test)
  - 9ad267b Reopen «Ватан 2»'s assembled part when «Ватан 1» routes another item
  - 29b69ab Pharmacy alarm settings, queue alarm and «нет в обеих» change notification
  - 937143f Always-on pharmacy sound, owner ringtones and one alarm interval
  - 2eb2316 One compact order table for «Ватан 1» and «Ватан 2»
  - 8c87940 Document job 014: pharmacy alarm settings, queue alarm, «Ватан 2» reopen, one order format
- Changed:
  - Backend: `backend/v1/admin_api/lambda_function.py` (`_reopen_pharmacy_two_assembly`, `unavailable_both` in
    `_pharmacy_change_notification`, settings GET/PATCH/preview with `pharmacy_alarm`, queue `alarm`),
    `backend/v1/shared/order_notification_settings.py` (`pharmacy_alarm` defaults/bounds/allowlist,
    `effective_settings`, `validate_update` 4th key, `stored_policies`), `backend/v1/telegram_notifier/lambda_function.py`
    (`unavailable_both` line).
  - Backend tests: `test_staff_accounts.py` (reproduction + queue alarm + four `_notification` cases),
    `test_order_notification_settings.py`, `test_telegram_notifier.py`, `test_pharmacy_answers.py` (one audit-count
    filter, see below), `test_admin_order_item_adjustments.py` (preview payload now carries `pharmacy_alarm`).
  - Frontend: `src/lib/pharmacy-alarm.ts`, `src/lib/pharmacy-alerts.ts`, `src/components/PharmacyOrderAlerts.tsx`,
    `src/app/staff/StaffShell.tsx` + `layout.tsx` (dropped the `accountId`/`pharmacyId` props — no longer needed),
    `src/app/staff/orders/NotificationPermission.tsx` (sound hint), `src/app/admin/order-notifications/*`
    (new `PharmacyAlarmSettings.tsx`), `src/app/staff/orders/PharmacyItemRow.tsx` (new),
    `PharmacyOrderCard.tsx`, removed `PharmacyRowActions.tsx` and `PharmacyRoutedItems.tsx`,
    `src/lib/pharmacy-order.ts`, `src/lib/pharmacy-answers.ts`, `src/lib/api-v1/{staff,admin}-types.ts`,
    `admin-server.ts`, `staff.css`, `admin.css`.
  - Tests: `tests/pharmacy-alarm.test.ts`, `tests/pharmacy-alerts.test.ts`, `tests/pharmacy-order.test.ts`,
    `tests/pharmacy-answers.test.ts` (all already in `test:frontend`).
  - Docs: `API_CONTRACT.md`, `docs/order-notification-settings-rollout.md`, `docs/PROJECT_CONTEXT.md`.
  - No migration (alarm lives under the reserved `pharmacy_alarm` key of the `policies` JSONB). `backend/local-agent/agent.py` untouched.
- Acceptance criteria:
  1. Sound ✅ — `soundLabel(running)` only returns «Звук включён» / «Звук включён — коснитесь экрана»;
     `soundPreference()` is always on (missing / '0' / '1'); AudioContext created + `resume()` on mount;
     window `pointerdown`/`keydown`/`touchstart` (capture) unlock with no confirmation. Unit-tested in
     `tests/pharmacy-alerts.test.ts`. **Manual check in installed Edge/Chrome on Windows not done** (no browser
     run in this round) — open item for the owner/approver.
  2. System notification ✅ — fired for every due alert when `Notification.permission === 'granted'`, visible or
     hidden; payload from `systemNotification()` (`tag: pharmacy-<id>`, `renotify: true`, text from `alertText`);
     unit-tested incl. no client data.
  3. Alarm ✅ — `tests/pharmacy-alarm.test.ts`: 4 ringtones × 5/60/120 s, no note ends after start + duration,
     gain ≤ 0.22, stop stops/disconnects every oscillator; `createAlarmSlot` test shows a new alarm stops the
     previous one. Defaults classic/60/60; `remindIntervalMs` takes no pharmacy id; parse/clamp/fallback tested.
  4. Admin settings ✅ — backend tests: GET returns `pharmacy_alarm`; PATCH accepts valid values, rejects unknown
     ringtone, non-int / bool / out-of-bounds, duration > interval, missing/extra keys; rows without the key read
     as defaults; channel policies unchanged and unknown JSON keys never leak into channels; audit has previous
     and current `pharmacy_alarm`; non-admin GET/PATCH → 401/403 without DB. Admin page: ringtone select,
     «Прослушать» (5 s) / «Остановить», «Длительность сигнала, сек», «Повторять каждые, сек», Russian errors
     (`validateAlarmForm`, unit-tested). Not clicked in a browser this round.
  5. Pharmacy read ✅ — queue returns `alarm` for pharmacy 1 and 2 (backend test; still exactly 2 read-only
     statements); `PharmacyOrderAlerts` reads it on each poll via `parseAlarmConfig`.
  6. «Ватан 2» bug ✅ — reproduction `test_vatan2_assembled_part_reopens_when_vatan1_routes_another_item`
     failed before the fix (commit 9856fa7: no reopen statement) and passes after: the reopen runs on the same
     cursor/transaction after the routing UPDATE, only `WHERE … pharmacy_id = 2 AND state = 'assembled'`, with the
     `pharmacy.order.assembly_reopened` audit (CTE, audit only when a row was reopened); «Ватан 2»'s queue row
     gets `needs_attention: true`, stage `assembling`, `_require_assembly_complete` raises `ASSEMBLY_NOT_COMPLETE`.
     A second test shows no reopen without routing.
     Also confirmed by reading the code: account 2 → `list_pharmacy_preparation_orders(query, account["account_id"])`
     → pharmacy_id 2 (existing test `test_pharmacy_two_queue_is_scoped_by_session_account`); the routed item has
     `fulfillment_pharmacy_id = 2`, so the order matches `{_ITEM_PHARMACY_SQL} = 2`, ordered `o.id DESC` with the
     default limit 20 — it is on the first page unless 20+ newer live orders sit at «Ватан 2». No other cause found.
  7. Format ✅ — both pharmacies render `PharmacyOrderCard` → `PharmacyItemRow`; compact «В наличии» / «Нет в
     наличии» in a narrow cell right after «Сумма»; no action row, no footer item list; price tap → inline input
     (Enter/✓ posts `{answer:'available', base_unit_price}` via `pharmacy-answers`, Esc/× cancels); inline
     confirmation at both pharmacies; no price editor when prices are hidden. View flags tested in
     `tests/pharmacy-order.test.ts`. `npm run lint` ✅, `npx tsc --noEmit` — only the pre-existing
     `tests/category-icon-preview.test.ts(5,15) TS2540` (same error on `main`), `npm run build` ✅.
  8. Owner Telegram ✅ — `_notification` tests for «Ватан 1» price, «Ватан 2» price, «Ватан 1» routing, «Ватан 2»
     «Нет в наличии» (`unavailable_both`), no client data; claim regex already accepts the key (existing tests);
     notifier formats `unavailable_both` («— нет в наличии в обеих аптеках»), no client fields in any change
     message; the Next route strips `_notification` and calls the notifier in `after()` (source-level test in
     `tests/pharmacy-answers.test.ts`); the inline price edit posts only through `pharmacy-answers`.
- Tests run (from the worktree):
  - `python3 -m unittest discover -s backend/tests -t .` → 417 tests, 3 pre-existing failures only:
    `test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`
    and `test_has_more_and_cursor_round_trip_for_delivered` (the last one also fails on an untouched checkout of this
    branch's base `d41e9d3` — run before any change; not listed in the job brief, date-dependent). No new failures.
  - `npm run test:frontend` → 173 pass, 0 fail.
  - `npm run lint` → clean. `npm run build` → success. `npx tsc --noEmit` → only the pre-existing TS2540 above.
- Notes for reviewers:
  - `test_pharmacy_answers.test_audit_row_has_exact_shape_and_no_client_data` now ignores the reopen statement when
    counting audit rows (that statement contains `INSERT INTO admin_audit_log` inside its CTE); the asserted
    items-answered audit row is unchanged.
  - `validate_update` now returns a 4-tuple and requires `pharmacy_alarm` for PATCH and preview (spec: required
    fourth key). Between deploying the new admin Lambda and Vercel, the old settings page cannot save/preview
    (documented in the rollout doc).
  - «Нет в наличии» at «Ватан 2» shows «Нет в наличии в обеих аптеках» for any own item of «Ватан 2» (website orders
    always start at «Ватан 1», so every «Ватан 2» item in its queue was routed).
  - A collected «Ватан 2» item is final: no answer buttons, no price editor.
- Open questions / not done:
  - Manual check in installed Edge/Chrome on Windows (does sound play without a tap; OS notification sound) — not
    done in this round.
  - Nothing deployed, no migration, no live AWS calls.

## Round 2
- Commits: 7869b67 Round 2: 44 px row controls on touch screens, focus return, Esc on confirm, alarm after unlock
- Changed: `src/app/staff/staff.css`, `src/app/staff/orders/PharmacyItemRow.tsx`, `src/components/PharmacyOrderAlerts.tsx`,
  `src/app/staff/orders/NotificationPermission.tsx`, `src/app/admin/admin.css`, `backend/v1/admin_api/lambda_function.py`
  (docstring only), `tests/pharmacy-order.test.ts`.
- Review findings addressed:
  - review-ux CHANGES 1 (touch targets < 44 px) → new `@media (max-width: 640px), (pointer: coarse)` rule:
    `.pa-mini`, `.pa-price-tap`, `.pa-price-inline input` min-height 44 px; `.pa-mini` and the inline ✓/× min-width
    44 px; group gap 6 px. The 420 px `.pa-mini-group` cap raised from 150 to 200 px (the table already scrolls
    sideways inside `.pharmacy-items-scroll`). Desktop stays compact. Guarded by a source-level test in
    `tests/pharmacy-order.test.ts`.
  - review-ux note: Esc closes the inline «Нет в наличии» confirmation → `onKeyDown` on the confirm group.
  - review-ux note: focus falls to body after save/cancel → focus returns to the price button (price editor) or the
    first enabled row button (confirmation), via a ref + effect.
  - review-ux note: `aria-live` on the sound button → removed; a separate `sr-only` status span announces the label.
  - review-ux note: four lines of small text → sound hint merged into the permission note paragraph.
  - review-code note: alarm skipped while audio is locked → `pendingAlarm` ref; when audio becomes `running` and
    orders still need attention, the alarm plays at once instead of waiting a cycle.
  - review-code note: hardcoded `'staff:1'` reopen actor → docstring explains it (only «Ватан 1» routes).
  - review-ui note: admin alarm select/input/button get a `:focus-visible` outline.
  - Not changed: review-ui 40 px suggestion (superseded by the 44 px UX fix); the «Прослушать» grid alignment was not
    checked in a browser.
- Tests run: `npm run test:frontend` → 174 pass, 0 fail; `npm run lint` → clean; `npm run build` → success;
  `python3 -m unittest backend.tests.test_staff_accounts backend.tests.test_pharmacy_answers` → OK.
- Open questions / not done: manual check in installed Edge/Chrome on Windows (sound without a tap) and a browser pass
  at 390 px are still open for the approver/owner. Nothing pushed or deployed.

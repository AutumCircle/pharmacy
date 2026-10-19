## Round 1
- Commits: 88d2bdd feat(staff): pharmacy order alerts — signal, sound, 3-minute reminders, permission panel (job 012)
- Changed: backend/v1/admin_api/lambda_function.py, backend/tests/test_staff_accounts.py, src/lib/pharmacy-alerts.ts (new),
  src/lib/pharmacy-alert-store.ts (new), src/components/PharmacyOrderAlerts.tsx (new), src/components/NewOrderAlerts.tsx
  (only `export` on `chime`), src/app/staff/StaffShell.tsx, src/app/staff/orders/page.tsx,
  src/app/staff/orders/PharmacyAlertBanner.tsx (new), src/app/staff/orders/NotificationPermission.tsx (new),
  src/app/staff/staff.css, src/lib/api-v1/staff-types.ts, tests/pharmacy-alerts.test.ts (new), package.json, API_CONTRACT.md
- "Not reacted" re-checked against merged 011 — adjustments:
  - An «Нет в наличии» answer from «Ватан 1» routes the item to «Ватан 2», so it leaves «Ватан 1»'s assigned set and
    the items LATERAL no longer sees that answer. Reaction therefore also counts `routed_away_count > 0` (items this
    pharmacy answered that now sit elsewhere). Otherwise «Ватан 1» would be nagged after answering.
  - Per-item «Собрано» (011 rework, `order_item_assembly`) also counts as a reaction (it requires an «В наличии»
    answer anyway, so this is belt-and-braces).
  - Implemented as one extra aggregate in the existing items LATERAL:
    `COUNT(*) FILTER (WHERE mine.answer IS NOT NULL OR col.order_item_id IS NOT NULL) AS reacted_count`; reacted =
    reacted_count > 0 or routed_away_count > 0 or assembly_state not null. No new joins, no N+1, params unchanged.
  - `attention_since`: when unreacted all assigned items are unanswered, so it reuses the existing
    unanswered_unrouted / unanswered_routed_since aggregates: earliest `pharmacy_assigned_at` when every assigned
    item was routed here («Ватан 2» routed order), else `created_at` (also covers an order originally assigned to
    «Ватан 2», and a mixed one — same rule as `waiting_since`).
  - Per spec, `needs_attention` applies to `pending` and `confirmed` queue orders alike (a confirmed order with no
    mark/answer from this pharmacy still reminds). Note: an admin quantity/price change voids the current pharmacy's
    answer (`_invalidate_pharmacy_answers`); if that pharmacy has no assembly mark the order becomes unreacted again
    and reminders resume — consistent with "must be answered again".
- Design notes:
  - Poll = `GET /api/staff/orders` without params → Lambda pharmacy queue, first page (limit 20, newest first). Orders
    beyond the first 20 of the queue are not counted (acceptable; noted).
  - The banner on /staff/orders starts from the server-rendered count and then follows the live count published by
    PharmacyOrderAlerts through a tiny module store (`pharmacy-alert-store.ts`, useSyncExternalStore). «Показать»
    refreshes the page list (the list is server-rendered and does not auto-refresh; no auto-refresh so an open answer
    form is never disturbed). Toast click also dismisses the toast and calls router.refresh().
  - Sound button is fixed bottom-right (pharmacy main gets extra bottom padding so it never covers card buttons).
    States: «Включить звук» → tap enables, unlocks AudioContext, chimes, saves `vatan-pharmacy-sound=1`;
    after reload «Нажмите, чтобы включить звук» until any tap/keypress (window listener) or a tap on the control;
    «Звук включён» → tap turns it off (`0`). The control stops pointerdown/keydown propagation so the window unlock
    listener cannot flip state under the same tap. If iOS suspends the context, the label returns to «Нажмите…».
  - System notification only when permission granted and tab hidden, wrapped in try/catch, tag `pharmacy-<order_id>`.
  - Courier/admin NewOrderAlerts: behaviour unchanged (30 s, `vatan-order-sound`, new-ids only); only `chime` exported.
- Acceptance criteria:
  1 ✅ (code + mocked-cursor tests) unreacted → true/created_at; answered → false/null; routed-away answer → false;
    assembling/assembled (pending and confirmed) → false/null; «Ватан 2» routed → routing time; all-off policy keeps
    both fields; only the two existing SELECTs are executed; no migration.
  2 ✅ tests/pharmacy-alerts.test.ts covers first-seen, <180 s, =180 s, >180 s, reacted, absent, missing field (old Lambda).
  3 ✅ implemented (toast per due order, banner, `(N)` title, removal when needs_attention false/absent within one poll);
    browser behaviour not exercised here — manual check.
  4 ✅ implemented as specified; separate key; manual check needed for real autoplay behaviour.
  5 ✅ permissionView tested for granted/denied/default/unsupported + installed text + iOS hint only on iOS
    outside standalone; requestPermission only in the button's click handler.
  6 ✅ alertText returns only reference/fallback and minutes; test with customer_name/phone/address/landmark/
    comment/amounts on the object asserts none leaks. Title shows only `(N)`.
  7 ⏳ NOT DONE — manual device check on «Ватан 1»/«Ватан 2» devices (Android Chrome, iPhone Safari tab + home-screen)
    requires the Lambda deploy and real devices; must be done by the owner before approval.
  8 ✅ see tests below.
- Tests run (from the worktree, after `npm ci`):
  - `npm run lint` → clean
  - `npm run build` → success
  - `npm run test:frontend` → 130 tests, 130 pass (incl. 14 new in tests/pharmacy-alerts.test.ts)
  - `python3 -m unittest discover -s backend/tests -t .` → 361 tests; only the 2 known main failures
    (test_banner_title_can_be_empty_for_image_only_banner, test_quantity_on_delivered_order_recalculates_total_and_audits)
  - `python3 -m unittest backend.tests.test_staff_accounts` → 54 OK (7 new tests)
- Open questions / not done:
  - AC7 manual device check (see above). Deploy of admin-api-v1.zip is ESCALATE and not part of this job (after 011's
    0025 + Lambda). The UI tolerates the old Lambda (no needs_attention → no reminders, banner hidden).
  - Follow-ups unchanged: 012b Web Push (manifest/SW/VAPID/migration/sender), Telegram to «Ватан 2» on routing.
  - backend/local-agent/agent.py untouched.

## Round 2
- Commits: 73aa8d5 fix(staff): pharmacy alerts review round 1 — no sound dead-end, 44 px targets, a11y (job 012)
- Changed: src/components/PharmacyOrderAlerts.tsx, src/lib/pharmacy-alerts.ts, tests/pharmacy-alerts.test.ts,
  src/app/staff/orders/PharmacyAlertBanner.tsx, src/app/staff/staff.css
- Review findings addressed:
  - review-ux CHANGES 1 (sound control dead-end) → new pure `soundClickAction(preference, unlocked, unlockFailed)`
    ('enable' | 'unlock' | 'disable'), tested. No AudioContext / constructor throws → preference set off and note
    «Звук недоступен в этом браузере. Сигнал на экране работает.» (also when first enabling). Context exists but
    not running after the tap → note «Браузер не дал включить звук. Нажмите ещё раз, чтобы выключить звук. Сигнал на
    экране работает.» and the next tap switches sound off. The note is a small fixed `role="status"` box above the control.
  - review-ux CHANGES 2 (touch targets) → toast × 44×44 (negative vertical margin so the toast does not grow),
    `.pa-banner button`, `.pa-permission-row button` and `.pa-sound` min-height 44 px.
  - Non-blocking (review-ui/ux), done: decorative `pa-pulse` removed (slide-in kept, reduced-motion respected);
    hover and focus-visible styles on all new buttons and the toast link; toast stack no longer `role="alert"` —
    a polite sr-only live region announces only newly due order titles; `aria-pressed` dropped from the sound
    button (its label already changes); banner «Показать» shows «Обновляю…» (disabled) during router.refresh().
  - Not changed (noted as acceptable by reviewers): toast stack may cover the header on mobile (dismissible, max 4 +
    «Ещё заказов: N»); first-page-only polling; security note about a slimmer alerts view (future).
- Acceptance criteria: unchanged from round 1; AC4 now also covers unavailable/blocked audio without a dead-end.
  AC7 (manual device check) still open — owner, after the Lambda deploy.
- Tests run (worktree):
  - `npm run lint` → clean
  - `npm run test:frontend` → 131 tests, 131 pass (1 new: soundClickAction)
  - `npm run build` → compiled successfully (the usual sitemap "API v1 server configuration is incomplete" log
    without env; build completes)
  - Backend not touched this round (round 1: only the 2 known main failures).
- Open questions / not done: AC7 manual device check; Lambda deploy (ESCALATE); follow-ups 012b and Telegram «Ватан 2».

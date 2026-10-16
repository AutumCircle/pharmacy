VERDICT: PASS

The flow works end to end: pharmacy card (confirmed order) shows the chip «Сборка: Ждёт сборки» and «Начать сборку», then «Собран», then the chip «Собран». The courier sees one line per pharmacy in the order card and a short line in the list. Nothing dead-ends.

Checked:
- States: busy ("Сохраняем…", button disabled), error (role="alert", focused, Russian, with next step), 404/409 refresh the card, network failure message. Old Lambda (no fields) gives no buttons, no marks, no warning.
- Copy: Russian and calm. Fallback messages say to retry.
- Product rules: no change to totals, 50 TJS minimum, out-of-stock or admin controls. The «Выехал» button stays enabled, the warning is only a note, and customer statuses are unchanged.
- Accessibility: buttons are native with min-height 48px. The warning is `role="note"` and the action bar wraps at 360 px. The card's status label «Согласован» avoids contradicting «Ждёт сборки».

Notes (non-blocking):
- `src/app/staff/orders/PharmacyAssemblyButtons.tsx:50`: «Собран» has no confirmation and there is no undo (known in the spec Risks). Consider a short confirm in a follow-up.
- `src/app/staff/orders/CourierOrderList.tsx`: the list line uses the same class as the answers line, which is fine. The `·` separator between two pharmacies could wrap on 360 px, which is acceptable.
- Amber/green line colours on `--c-bg` backgrounds are text-on-tint pairs already used elsewhere. Contrast looks OK, but I did not check it in a browser.

VERDICT: PASS

Reviewed spec, build.md and the diff (static review; not clicked in a browser).

Flow: the card shows 8 ordered steps in Russian, done steps get a check and green style, the next step is highlighted (aria-current="step"). Manual steps save optimistically and roll back with a Russian message. Steps 3/6/8 call the existing status endpoint with expected_current_status, and 409 handling is kept. The list shows «N из 8 шагов · следующее действие», and own and cancelled orders show nothing. Tracking is untouched. Product rules in UI_DESIGN_SPEC §2 are not affected (no totals, cart or admin controls changed).

Accessibility: each manual step is a real checkbox inside a label, covering the full 52 px row; focus-visible is drawn on the mark; the progress bar has role=progressbar; error uses role=alert; sr-only "Выполнено" exists in the CSS. Rows are wide and tall enough for 390 px.

Notes (non-blocking):
- CourierOrderDetail.tsx:~292 (status action button) has min-height 40px (staff.css .c-check-action); raise to 44px for touch.
- A status-button error (e.g. network failure) renders in the error line below the fee block (CourierOrderDetail.tsx:353), possibly off-screen from the checklist the courier just pressed. Consider showing it inside the checklist.
- Step 1 checkbox is independent of whether the fee was actually saved; the courier can tick it without entering a fee. Acceptable, but could be auto-hinted.
- Done steps 3/6/8 have no visible text "Выполнено" for sighted users apart from the check mark; fine.
- Checkbox error text «Шаг 2 не сохранён: …» is clear; consider adding "Проверьте связь и повторите" when the message is generic.

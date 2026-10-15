VERDICT: PASS

Scope: courier staff screen only (no customer-facing change; statuses and /tracking untouched).

Checked
- Flow: 7 steps in the owner's wording and order. Steps 4/5/7 show «Согласовано» / «Выехал» / «Доставлен» only when the order is in the `from` status, so nothing dead-ends. Manual steps 1/2/3/6 are checkboxes with a disabled-while-saving state, rollback on error and a Russian error line (`role="alert"`). 409 refreshes the screen. The step-1 link to the fee field is kept.
- Copy: Russian and calm. The route errors «Шаг должен быть числом от 1 до 7» and «Этот шаг отмечается сменой статуса заказа» are plain. Status-linked hints name the resulting status.
- Product rules: delivery fee, 50 TJS minimum, stock and admin controls are not touched.
- A11y and mobile: the whole row is a `<label>` (large touch target, min-height 52px), the progressbar has a label and values, `aria-current="step"` is set, and "Выполнено" is announced to screen readers for derived steps. The list row uses `min-width: 0` plus ellipsis, so the long titles cannot break it. In the card, `.c-check-text` has `min-width: 0` and wraps, so the 100+ character step 7 title wraps rather than overflows.

Notes (non-blocking)
- `CourierOrderDetail.tsx:272` the error reads «Шаг N не сохранён: …». With the long titles, a step number is still fine, but naming the step title would be clearer.
- The bottom action bar uses the labels from `src/app/staff/status.ts` (`nextStep`), which may differ from the in-card button names («Согласовано» / «Выехал»). Consider aligning them.
- Hand check of acceptance criterion 5 (390 px mobile, real flow) was not done by the builder. It is still required before deploy.
- Known trade-off: old «Позвонить клиенту» ticks are dropped. The approver should confirm this.

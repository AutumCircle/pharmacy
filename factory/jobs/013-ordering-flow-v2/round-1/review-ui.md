VERDICT: CHANGES

Review is by code reading (no browser run). Overall the job reuses `od-*`, `ao-*`, `c-*`, `pa-*` classes and the staff tokens, keeps the calm tone (no animation or promo), and the read-only admin block is structured well.

## Blocking

1. `src/app/tracking/page.tsx:99-112` (customer stepper, 5 steps). Each step is `width: 20%` with a fixed `fontSize: '13px'` label. At 390 px the card content is roughly 300 px, so a step is about 60 px wide. «Подтверждён» (13 px, about 85 px) is wider than its column. It overflows into the neighbouring labels or forces horizontal scroll, and «Собирается» is also tight. Fix: give the label `minWidth: 0`, `overflowWrap: 'anywhere'` (or `hyphens: 'auto'`), and a smaller size on mobile (11-12 px, as `.od-progress` and `.c-progress` use 11 px). Also shrink the circle to about 28 px at narrow widths, or move the stepper into a class with a `@media (max-width: 480px)` rule. Check at 390 px that nothing scrolls horizontally.

2. One-off colours instead of tokens:
   - `src/app/admin/orders/orders-ui.css:187` and `src/app/staff/staff.css:144` use `#e3f4f1` / `#0f6b5c` for the «Собран» pill. Add one token per scope (for example `--ao-teal(-soft)` and `--c-teal(-soft)`), or reuse `--ao-ok(-soft)` / `--c-blue(-soft)`. If a new colour is wanted, define it as a variable next to the other tokens. Check that its contrast is at least 4.5:1 on the soft background (the proposed text colour is fine).
   - `orders-ui.css` `.od-ff-tone-orange` uses `#fff0e0` / `#a34f00`. The staff side already has `--c-orange` / `--c-orange-soft`. Define the same orange in the admin `--ao-*` set instead of hard-coding it.
   - `staff.css` `.pharmacy-items tr.pa-row-routed td` uses `#5c3a1c`, `#fdeced` and `#7a1418`. Use `var(--c-orange)` for the text, `var(--c-brand-soft)` for the red background and `var(--c-brand-dark)` for the red text (these tokens exist).

## Non-blocking

- `staff.css` `.pa-row-controls .pa-btn.selected` uses `rgba(0,0,0,.18)`. Fine. Check that the disabled-and-selected state (opacity .55 with inset ring) still reads clearly as "chosen".
- `PharmacyRowActions.tsx`: three buttons per row at `flex: 1 1 120px` stack to full-width rows at 390 px. That is acceptable, but with many items the card gets long. Consider a compact `min-height: 40px` for secondary «Изменить цену».
- `OrderFulfillment.tsx`: the `.od .sr-only` rule is scoped to `.od`. Make sure the section is rendered inside `.od`, otherwise the hidden text becomes visible.
- Admin `.od-progress` and the staff `.c-progress` now have 5 columns at 11 px. «Подтверждён» is about 70 px, so at 390 px (about 60 px columns) it will clip or touch. Add `overflow-wrap: anywhere` or `font-size: 10px` under 480 px.

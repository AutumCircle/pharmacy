VERDICT: PASS

Review by code only (no browser run). The change reuses the existing `ao-*` classes and the `--ao-*` tokens from `orders-ui.css`. No one-off colours were added except `#b9c3bd`, which already exists in the accent card, and `#d5dbd7`, which `.ao-more` already uses.

Checked:
- KPI cards: they are now `<a class="ao-kpi">` with the same layout. Hover, `:focus-visible` (3px blue outline) and open state (brand-colour ring, `aria-current`) are all visible. The accent card keeps its white text because `strong`, `span` and `small` have explicit colours.
- Drill panel: it uses `ao-card`, `ao-card-head`, `ao-table`, `ao-more` and `ao-empty`, so it matches the neighbouring sections. Loss rows get a light red background, a left bar, dark red text and a screen-reader «Убыток:» prefix, so meaning is not carried by colour alone. Contrast of `--ao-brand-dark` on `--ao-brand-soft` is fine.
- Responsive: the table sits in `.ao-table-wrap` (`overflow-x: auto`, min-width 760), so at 390 px only the table scrolls and the page does not. The summary tiles wrap with `flex-wrap`. The close button is `flex: none` and the head wraps.
- Tone: calm. The only motion is a 1px hover lift, and it is switched off under `prefers-reduced-motion`.

Notes (non-blocking):
- `orders-ui.css:329` The hover `translateY(-1px)` is decorative. Dropping it would match the calm tone better, but it is harmless.
- `orders-ui.css:61` `.ao-kpi strong` has `nowrap` and ellipsis. A very large sum at 390 px (two-column grid, 18px) could be clipped. The `aria-label` carries the full value, but a visible `title` would help.
- The hint «N заказов · созданы за период, кроме отменённых» is long. In the 6-column layout at 1440 px it wraps to 3 lines, so card heights will differ slightly. This is acceptable because the grid aligns the cards (`align-content: start`).
- `orders-ui.css:350` The `.ao-sr` rule is local. Check whether a shared `sr-only` utility exists and reuse it.

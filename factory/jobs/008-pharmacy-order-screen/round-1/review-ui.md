VERDICT: PASS

Reviewed by code reading (no browser run): PharmacyOrderCard.tsx, WaitingMinutes.tsx, staff.css diff, page.tsx diff.

Findings: none blocking.
- Reuses `.courier-order-card`, existing staff palette (#b71920, #e0e5e1, #4f5a52, #effaf2, #e3effb) and the same status-pill pattern as courier cards; no new tokens or one-off fonts.
- Hierarchy: number (red) and date, status pill, waiting badge, table, total row, notes. Total is green and bold; quantity is blue and bold.
- Responsive: table sits in `.pharmacy-items-scroll` (overflow-x:auto, min-width 320) with a smaller font and padding at the mobile breakpoint, so the page itself does not scroll sideways at 390 px. Names wrap (`overflow-wrap:anywhere`). The grid uses `minmax(0,1fr)`.
- Contrast: white on #c4161c / #b71920, #7a4a00 on #fff1d1 and #134d86 on #e3effb are all readable. Waiting levels (neutral, amber, red) are calm, with no animation or countdown effects.
- Empty `actions` footer is hidden via `:empty`, so there is no stray spacing.

Notes (non-blocking):
- staff.css:~92 `.pharmacy-order-status.pending` is a solid red pill and `.pharmacy-waiting.urgent` is solid red too. Two red blocks on one card can be loud; consider the lighter courier-pending style for the status pill.
- Colours are hardcoded hex, consistent with the rest of staff.css (no CSS variables in this file).
- The «Обновить» link has no focus style change beyond the browser default; this is pre-existing.

VERDICT: PASS

Reviewed by code reading (no browser run): PharmacyOrderCard.tsx, WaitingMinutes.tsx, staff.css diff, page.tsx diff.

Findings: none blocking.
- Reuses `.courier-order-card` and the existing staff palette. No new fonts or one-off sizes beyond the card's own scale.
- The round-1 note is fixed. `.pharmacy-order-status.pending` is now the light pill (#a3161c on #fdeced), and only `.pharmacy-waiting.urgent` is solid red, so the card is calmer.
- The new price columns (Цена, Сумма, Клиенту) and the client block only render when the policy returns the data, so turning the settings on shows them. At 390 px the table scrolls inside `.pharmacy-items-scroll`. The page itself does not scroll sideways. Names wrap, and numbers use `nowrap` and tabular figures. The mobile font size and padding are reduced.
- Contrast is fine: #a3161c on #fdeced, #134d86 on #e3effb, #7a4a00 on #fff1d1, and white on #c4161c. The waiting badge has no animation or countdown effect. It updates as plain text every 30 s.
- The `tel:` link is blue and underlined by default. The empty actions footer is hidden with `:empty`.

Notes (non-blocking):
- The `.pharmacy-order-client a` link and the "Обновить" link have no custom focus or hover style. They use the browser default, as elsewhere in staff.css.
- With all five columns on at 390 px, the horizontal scroll inside the table has no visual hint. Consider a subtle edge shadow later.

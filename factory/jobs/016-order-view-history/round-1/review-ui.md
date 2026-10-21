VERDICT: PASS

Static review of the diff (no browser run). Tokens used (--ao-*, --c-*) all exist; no one-off colors except existing hex already used in the file (#edf0ee, #f6f8f7).

Checked
- Admin items table (OrderItems.tsx, orders-ui.css): real table with caption, th scope, sr-only headers; wrapped in .od-table-wrap (overflow-x) and collapsed to a card-like grid at <=720px (thead hidden, qty/price merged "N × price"), so no horizontal scroll at 390 px. Name uses overflow-wrap:anywhere.
- Edit button is a real focusable button with aria-label and a visible focus ring (outline 3px --ao-blue); row hover state present.
- History: dots coloured by actor from existing tokens; latest event gets a soft ring, no animation. Order of cards on mobile updated (od-o1..o7), client moved up as requested.
- Courier (staff.css, CourierOrderDetail.tsx): client first, phone as tel link, 52 px call button, grouped pick-up places, collapsed <details> history with 44 px summary; focus-visible outlines; the only transition (chevron) is disabled under prefers-reduced-motion. Calm tone, no promo or countdowns.

Notes (non-blocking)
- orders-ui.css `.od-item-edit` is 32 px; on touch the admin rarely edits, but 36-40 px would match the 36 px grid column on mobile.
- OrderItems.tsx: row onClick is mouse-only on the <tr>; keyboard users use the pencil button, which is fine. Consider a visible text hint ("Изменить") on mobile instead of the ✎ glyph alone.
- `.od-sums .od-sum-wait dd` uses --ao-amber on --ao-amber-soft; verify contrast >= 4.5:1 (#8a5a00 style amber is fine, confirm --ao-amber value).
- `.c-history-count` white pill on --c-bg-style block: check it stays readable if the block background is the card white (invisible pill, still legible text).

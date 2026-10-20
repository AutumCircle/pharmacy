VERDICT: PASS

Reviewed the diff of src/app/staff/staff.css, src/app/admin/admin.css, PharmacyItemRow.tsx, PharmacyAlarmSettings.tsx and PharmacyOrderAlerts.tsx. Code review only; I did not run the app at 1440 px or 390 px.

- Row controls and price edit use the existing staff tokens (--c-ok, --c-brand, --c-line, --c-orange-soft). The routed-row tone reuses the job 013 classes.
- The table sits inside .pharmacy-items-scroll (overflow-x: auto, staff.css:105), so a wide table scrolls inside its card and the page does not scroll sideways at 390 px. The .pa-mini-group max-width drops to 150 px under 420 px, and the confirm text wraps.
- Focus-visible outlines exist for .pa-mini and .pa-price-tap. Disabled, hover and selected states are visible.
- Admin alarm form: the layout collapses to one column under 560 px, inputs are 44 px high, and the error list uses role="alert".
- Tone is calm: no countdowns, and the only motion is the bell status indicator.

Notes (non-blocking)
- staff.css (.pa-mini, .pa-price-tap, .pa-price-inline input): the touch targets are 32 px high, below the 44 px used elsewhere in the staff UI. This is a deliberate trade-off for a compact table. If staff mis-tap on phones, raise min-height to 40 px at max-width 560 px.
- admin.css (.notification-alarm-fields select/input and .notification-alarm-listen button): there is no :focus-visible style, so they rely on the browser default. Hex colors (#b5121b, #667085) are used instead of tokens, which matches the surrounding admin.css. Consider adding an outline for keyboard users.
- admin.css (.notification-alarm-fields, align-items: end): the "Прослушать" button sits in the second grid cell next to the select. Check that it lines up with the select when a <small> hint is present on other cells.

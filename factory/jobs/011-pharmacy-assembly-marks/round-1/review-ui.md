VERDICT: PASS

Reviewed from the diff and CSS only. I did not render the pages at 1440 px or 390 px.

Findings: none blocking.
- Tokens: staff.css:408-418 uses only existing variables (--c-ok, --c-ok-soft, --c-amber, --c-amber-soft, --c-bg, --c-card, --c-muted). There are no one-off colours.
- Components and classes: the card reuses pa-chip, pa-tone-*, pa-btn, pa-btn-ok and pa-actions. The courier warning reuses c-check-warning. The courier list reuses c-row-answers (with `.done`).
- States: pa-btn already provides hover, focus-visible and disabled. The new pa-btn-start (outline in --c-ok) inherits them. The error paragraph is focused with role=alert.
- Responsive: pa-btn has flex-basis 200px and wraps. c-assembly-line uses overflow-wrap:anywhere. c-action-bar now has flex-wrap, and the warning takes the full row (flex-basis 100%), so there is no horizontal scroll at 390 px.
- Tone: calm. There is no animation, countdown or promotion. The warning is non-blocking amber text, as the spec requires.

Notes (non-blocking)
- staff.css:417 `.c-action-bar { flex-wrap: wrap; }` could be merged into the original rule at staff.css:291. On 390 px the sticky bar gets taller by one line when the warning shows. This is acceptable, but check that it does not cover content above the courier bottom nav.
- staff.css:411 `.pa-btn-start` (outline green) and `.pa-btn-ok` (filled green) are distinct and fine. The contrast of #187a3c on white is good.
- PharmacyOrderCard.tsx: the statusText change from «Собирается» to «Согласован» is deliberate. It avoids a clash with the assembly chip.

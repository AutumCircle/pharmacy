VERDICT: PASS

Static review only (no browser run). Visual change is limited to new step text/buttons rendered by existing components.

Findings: none blocking.
- Reuses existing classes (`c-check*`, `c-btn c-btn-outline`, `c-row-checklist`) and tokens; no new colours, sizes or spacing.
- `src/app/staff/staff.css:326`: `min-width: 0` added to `.c-row-checklist` so the existing nowrap/ellipsis truncates the long next-step title instead of widening the list row. Correct fix, no horizontal scroll expected at 390 px.
- Card: `.c-check-text` has `flex:1; min-width:0` and the title wraps normally, so the long steps 4, 5 and 7 (up to ~100 chars) wrap onto several lines next to the fixed-width action button. No overflow. Hover/focus/disabled/done/current states unchanged.
- Tone: no promo, countdowns or animation added.

Notes
- On 390 px, step 7 will wrap to about 4-5 lines beside the «Доставлен» button. Readable, but worth a quick eyeball on a dev build (build.md says the hand check was not done).
- Hints for steps 4/5/7 repeat the status wording, consistent with neighbouring screens.

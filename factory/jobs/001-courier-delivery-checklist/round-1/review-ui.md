VERDICT: PASS

Reviewed from the diff and CSS only (no browser run).

Checks
- Components and tokens: the new CSS in `src/app/staff/staff.css` uses the existing `--c-*` variables and the existing `c-block`, `c-block-title`, `c-btn c-btn-outline`, `c-error` and `sr-only` classes. The section matches the neighbouring blocks (customer, items, fee).
- Hierarchy and spacing: the checklist sits under the status progress bar and above the customer block. Rows have a 52 px minimum height, which suits touch use. The current step is highlighted and done steps are green.
- Responsive (390 px / 1440 px): `.c-check-text` has `min-width:0`, so long titles wrap. The row progress line uses ellipsis with nowrap, so it does not overflow. No fixed widths were added.
- Contrast and states: muted text (#66706a) on white and ok green (#187a3c) on the soft green background are both readable. The focus ring is on the mark through `:focus-visible`. The disabled and saving states use `cursor: progress`. The status-button disabled state comes from `statusBusy`.
- Tone: the only motion is a 0.2 s width transition on the progress bar. There are no countdowns or promotional elements.

Notes (non-blocking)
- `.c-checklist-bar span` transition: consider wrapping it in `@media (prefers-reduced-motion: no-preference)`.
- The `.c-check.current` highlight uses a hard-coded rgba of the brand red. If a brand-soft token is available, it could be used instead.
- `.c-check-link` has `margin-left:52px`, which is hard-coded to the mark and gap widths. Check the alignment visually.
- The status-button error shows in the existing error line below the fee block, not inside the checklist (already listed in build.md). Consider showing it near the checklist later.

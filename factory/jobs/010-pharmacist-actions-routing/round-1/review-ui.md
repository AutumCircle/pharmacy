VERDICT: CHANGES

Static review of the diff only (no browser run). Layout is sound: the card reuses `pharmacy-order-card`, rows wrap, buttons are 44-48 px high, and at 390 px the options collapse to a full-width column at 380 px and below. Tone is calm, with no animation or countdowns.

Findings (token reuse, small fixes)
1. `src/app/staff/staff.css:367,369,375,389,399,401,404` and the `.pa-*` / `.c-confirmed` block (lines 360-410) hard-code colours that already exist as `.staff-shell` tokens (lines 2-4). Replace them:
   - `#187a3c` -> `var(--c-ok)`
   - `#e3f5e9` / `#e3effb` -> `var(--c-ok-soft)` / `var(--c-blue-soft)`
   - `#8a5a00` -> `var(--c-amber)`
   - `#fff3d6` -> `var(--c-amber-soft)`
   - `#c4161c` / `#9f1117` -> `var(--c-brand)` / `var(--c-brand-dark)`
   - `#134d86` -> `var(--c-blue)`
   - `#dfe5e1` / `#edf0ee` -> `var(--c-line)`
   - `#4f5a52` -> `var(--c-muted)`
   `.c-confirmed.ok` already uses tokens, so `.c-confirmed` itself should be consistent with it.
2. `src/app/staff/staff.css:374` `.pa-btn` has no `:hover` or `:focus-visible` rule. Add `.pa-btn:hover:not(:disabled) { filter: brightness(.95); }` and `.pa-btn:focus-visible { outline: 3px solid rgba(196,22,28,.3); outline-offset: 2px; }`, matching `.pa-option:focus-within`.
3. `src/app/staff/staff.css:389-391` Selected radio options are told apart by colour only, while the label text differs, so this is acceptable. But the unselected state has no hover style. Add `.pa-option:hover { border-color: var(--c-muted); }`.
4. `src/app/staff/staff.css:404` `.c-check-warning { margin-left: 52px }` is a magic number tied to the mark width. Use the same left offset as the `.c-check-text` indent, or put the warning inside the row layout.

Notes
- `.pa-btn-ok` white on `#187a3c` has a contrast ratio of about 5.4:1, which is fine. `.pa-chip-wait` at `#4f5a52` on `#eef1ef` is fine too.
- `.pa-chip` and `.pa-tone-*` define the same four tones twice. Consider sharing one class.
- `.pa-btn-problem` uses a red outline for a routine answer. Brand red is acceptable here, but the neutral `c-btn-outline` would be calmer.
- Before merge, check 390 px by eye for the 3-option row (`flex: 1 1 96px`) with long Russian labels such as «Цена отличается».

VERDICT: CHANGES

Reviewed from the diff and the worktree files. No browser run.

## Findings (blocking)

1. Touch targets below the 44 px rule on mobile (`UI_DESIGN_SPEC.md:114`: "Interactive targets are at least 44 x 44 px on mobile").
   - `src/app/staff/staff.css`: `.pa-mini` has `min-height: 32px`. `.pa-price-tap` is 32 px. `.pa-price-inline input` and `.pa-price-inline .pa-mini` (min-width 32) are also 32 px. These are the main controls pharmacists use on a phone.
   - Fix: keep the compact look on desktop, and add a coarse-pointer / narrow-screen rule.
     `@media (max-width: 640px), (pointer: coarse) { .pa-mini, .pa-price-tap, .pa-price-inline input { min-height: 44px; } .pa-price-inline .pa-mini { min-width: 44px; } }`
   - Also raise the `max-width: 420px` `.pa-mini-group` cap (150 px) to about 200 px, or let the group wrap, so two 44 px buttons plus «Собрано» still fit. Check at 390 px that the table scrolls sideways rather than clipping.

## What works

- Sound always on. `soundLabel` only returns «Звук включён» or «Звук включён — коснитесь экрана», and the old «Включить звук» text is gone. `PharmacyOrderAlerts.tsx` creates the AudioContext on mount and unlocks it on `pointerdown`/`keydown`/`touchstart`. A tap on the control is just one more touch. The hint «Чтобы звук работал сразу…» is shown in `NotificationPermission.tsx`. The unsupported-browser state is covered by `SOUND_UNAVAILABLE`.
- The system notification fires for every due alert, visible or hidden, with text from `alertText` only.
- The alarm stops when `needs_attention` count is 0. The preview on the admin page has Listen/Stop, a 5 s auto-stop and unmount cleanup. Errors are in Russian and the number fields have visible ranges. The error list uses `role="alert"`.
- Row table. `PharmacyItemRow` gives the same format at both pharmacies, with compact buttons next to the sum, price tap-to-edit (Enter/✓ saves, Esc/× cancels), an inline confirmation for «Нет в наличии» and a per-row error (`role="alert"`, focused). Busy and disabled states exist. The selected state uses `aria-pressed`. Buttons and inputs have `aria-label`s that include the medicine name. The price editor is hidden when prices are hidden. «Нет в наличии в обеих аптеках» is shown at Ватан 2.
- Product rules are unaffected: there is no delivery fee in the pharmacy totals, and out-of-stock is a pharmacy answer, not a cart action. The change adds no destructive admin controls.

## Notes (non-blocking)

- `PharmacyItemRow.tsx`: after saving a price or confirming, the focused element (input or confirm button) is unmounted and focus falls back to `body`. Return focus to the price button or the row's first control for keyboard users.
- The inline «Нет в наличии» confirmation has no Esc handler. Add one, same as the price input.
- `NotificationPermission.tsx`: the hint plus the note «Сигнал и звук работают, пока эта страница открыта…» is four lines of small text on a phone. Consider merging the hint and the note.
- The manual check in installed Edge/Chrome on Windows (does sound play without a tap) is still open. This is acceptable for this round, but the approver should ask the owner to confirm it.
- The `.pa-sound` button now toggles nothing but is still a button with `aria-live`. That is fine as an indicator. Consider `aria-live` on a separate status span, so the announcement is not repeated on every click.

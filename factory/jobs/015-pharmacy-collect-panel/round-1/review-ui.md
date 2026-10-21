VERDICT: PASS

Visual change is small and reuses existing tokens and classes. Checked in the diff (not rendered in a browser).

- `staff.css:412` `.pa-btn-assembled` reuses `.pa-btn pa-btn-ok` (var(--c-ok), 48 px min height, shared hover/focus-visible/disabled). It is full width via `flex-basis:100%`, so it fits at 390 px and 1440 px. No one-off colours.
- `.pa-btn-start` was removed and has no remaining users in the diff.
- `PharmacyItemRow.tsx`: one `pa-mini pa-mini-bad` button remains per row, keeping the existing 44 px touch sizing and focus ring. The inline confirmation is unchanged. The row is shorter, so there is less overflow risk in the `max-width` action column.
- The tone is calm: no new animation or promotion.

Notes (non-blocking)
- `PharmacyAssemblyButtons.tsx:53` shows "Сборка: [chip]" next to a button also labelled "Собран" while the state is empty or assembling. That is fine, but the chip could be hidden when the state is null to avoid reading "Сборка: … / Собран" twice.
- After "Собран" only the chip remains. Consider a short line such as "Курьер получит сообщение", but only if the owner wants it.

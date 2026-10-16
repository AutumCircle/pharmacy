VERDICT: PASS

Reviewed from the diff and CSS only. I did not render the pages at 1440 px or 390 px.

Findings: none blocking.
- Tokens: the new colours are two variables, --c-orange and --c-orange-soft, declared with the other staff tokens (staff.css:4). Everything else uses existing variables. Orange #b54708 on #fff0e3 and on white is about 5:1 or better. The red and orange tones are never conveyed by colour alone: each has a text chip («Нет в наличии в обеих аптеках», «В аптеке 2») plus an inset left bar.
- Components: PharmacyRoutedItems.tsx reuses pa-item, pa-items, pa-chip, pa-tone-*, pa-btn, pa-btn-ok, pa-btn-problem, pa-btn-ghost, pa-btn-start, pa-problem input and pa-error. All of these exist in staff.css. The courier row tones reuse c-item with a modifier class.
- States: pa-btn gives hover, focus-visible and disabled. Buttons are disabled while busy and show «Сохраняем…». The error paragraph has role=alert and receives focus. The «Согласовано» button is disabled with a visible reason in the action bar and in step 4.
- Responsive: pa-item-marks, pa-routed-list li and c-action-bar all use flex-wrap. Names use overflow-wrap:anywhere. The routed block is width:100% with 12px padding, so there is no horizontal scroll at 390 px.
- Tone: calm. There are no animations, countdowns or promotional elements. The warning is amber, non-alarming text.

Notes (non-blocking)
- staff.css:411-427 repeats the same inset-bar pattern for the pa-item-tone-* and c-item-tone-* rules. Merging them would be tidier but is not required.
- staff.css:417 `.c-action-bar { flex-wrap: wrap; }` could be merged into the original rule at staff.css:291.
- The tone classes in staff.css:424-425 are used by routed-away list rows on a card with a blue-soft background. Check visually that the white row stands out. This is an optional visual check.

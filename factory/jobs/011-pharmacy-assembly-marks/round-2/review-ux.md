VERDICT: PASS

Round 2 (rework 1). The flow now matches the owner's note and nothing dead-ends:
- Pharmacy card on a «Новый» order: «Начать сборку» -> «Сборка сделана» -> chip «Собран» (`PharmacyAssemblyButtons.tsx`).
- «Ватан 2», per routed item (`PharmacyRoutedItems.tsx`): «В наличии» opens a price field (keep or change) with «Сохранить» / «Отмена», or «Нет в наличии»; then «Собрано». The part becomes «Собран» when all items are done.
- Colours: orange chip «В аптеке 2» and red «Нет в наличии в обеих аптеках» in the pharmacy card and the courier item list (`staff.css`: `.pa-item-tone-*`, `.c-item-tone-*`). Each has a text chip, so colour is not the only signal.
- Courier: block «Сборка в аптеках» in the card and a «Сборка: …» line in the list for new and confirmed orders. «Согласовано» is disabled while any pharmacy has not marked «Сборка сделана». The note above the button says why («Сначала все аптеки должны отметить «Сборка сделана»»). A 409 from Lambda shows the same text. «Отменить» stays available, so the courier is never stuck. After confirmation, the old non-blocking warning still applies to «Выехал».

States checked:
- Busy: «Сохраняем…» with the button disabled.
- Errors: `role="alert"`, focused, in Russian, with a next step («Повторите попытку»). 403/404/409 refresh the card.
- Network failure: message shown.
- Old Lambda (no new fields): no buttons, no gate, no warning.

Product rules: no change to totals logic on the client. Prices are recomputed in Lambda. Pharmacy 1 cannot edit a price (UI shows the price field only on routed items for «Ватан 2»). The 50 TJS minimum, out-of-stock add rule and admin controls are untouched. Customer statuses are unchanged.

Accessibility: native buttons with min-height 48px, input min-height 44px with a visible label, a list with `aria-label`, `:focus-visible` outlines, and the action bar wraps at 360 px.

Notes (non-blocking):
- `src/app/staff/orders/PharmacyRoutedItems.tsx` (price edit): the price input does not take focus when the editor opens. Add `autoFocus` for keyboard and screen reader users.
- `PharmacyAssemblyButtons.tsx`: «Сборка сделана» has no confirmation and no undo (known risk). Worth a follow-up.
- If a pharmacy never marks «Сборка сделана», the courier can only wait or cancel. This follows the owner's rule. Consider a visible hint of which pharmacy is pending (the marks line already shows it).
- Not checked in a browser. Contrast of the orange `#b54708` on `#fff0e3` looks sufficient by eye.

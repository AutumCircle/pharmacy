VERDICT: CHANGES

## Findings

1. **Customer stepper can break on 390 px (blocking, customer-facing).**
   `src/app/tracking/page.tsx:~99-112`. The stepper now has 5 columns of 20% width each. On a 390 px phone that is
   about 60-66 px per column, after the container and card padding. The label font is a fixed 13px, and «Подтверждён»
   (11 letters) is about 80 px wide. It will overflow into the neighbouring label or clip, so the main customer
   status screen becomes hard to read.
   Fix: shrink the label on narrow screens (for example `fontSize: 11px` with `overflowWrap: 'anywhere'` and
   `hyphens: 'auto'`, or `clamp(10px, 2.9vw, 13px)`). Also make the circles 28px. Check at 360 and 390 px that
   «Подтверждён» and «Собирается» fit without overlap. Add `aria-current="step"` on the active step so screen
   readers get the stage.

## Verified OK

- Flow: the five stages (Собирается → Собран → Подтверждён → В пути → Доставлен) are shared by the tracking page, admin
  and courier. The fallback to `status` exists for an old Lambda. The admin card is read-only with no buttons or
  inputs, and it is hidden when `fulfillment` is absent.
- «Ватан 1» row actions (`PharmacyRowActions.tsx`):
  - busy state «Сохраняем…», disabled buttons while busy, and «Отмена» on the price edit;
  - the error is shown with `role="alert"` and receives focus;
  - the Russian error says what to do ("Повторите попытку", "Нет связи");
  - the price input has a label, `inputMode="decimal"`, and a placeholder with the current price;
  - the buttons are 44 px tall (`staff.css` `.pa-row-controls .pa-btn`), which meets the touch target;
  - a routed row stays in the table, read-only, with the orange chip, or the red chip when «Ватан 2» also lacks it.
- Alerts: sound is limited to 10 s, a new alarm stops the previous one, and the intervals are 60 s and 180 s. The
  copy «Ждёт сборки N мин» and «Заказов ждут «Сборка сделана»: N» is calm and carries no client data.
- Product rules: no change to delivery fee in totals, the 50 TJS minimum, out-of-stock add-to-cart, or the absence of
  destructive admin controls.

## Notes (non-blocking)

- «Нет в наличии» on a «Ватан 1» row is immediate and cannot be undone. It sends the item to «Ватан 2» and also
  sends Telegram to the owner and the courier. It sits next to «В наличии» with only 8 px between them. Consider
  an inline confirmation ("Передать в Ватан 2? Да / Отмена") to prevent a mis-tap on mobile.
- When an item is sent to «Ватан 2», the price and line-total cells of the routed row show «—». That is fine. A small
  hint «Ждёт ответа Ватан 2» would help «Ватан 1» staff.
- `PharmacyOrderAlerts.tsx`: the toast title is «Заказ № X» without «Новый». That is acceptable. Consider
  «Заказ № X ждёт сборки» for clarity.
- The «Принять заказ» → «Согласовано» / «Подтвердить заказ» renames match the stages. Make sure the owner knows.
- The 10-second alarm plays only while the page is open (job 014 covers the closed app). The tap-to-enable
  sound state must stay visible to staff.

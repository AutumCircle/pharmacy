VERDICT: PASS

Scope: user-facing change on /staff/orders for the pharmacy role. Reviewed PharmacyOrderCard.tsx, WaitingMinutes.tsx, pharmacy-order.ts, page.tsx and staff.css.

Checks
- Flow: the list shows a card per order. The empty state "Сейчас заказов на сборку нет." is kept, and so are "Обновить" and pagination. Nothing dead-ends.
- Old Lambda response: no badge and no price columns, and nothing crashes. A bad date is caught by safeDateTime and the badge returns null.
- Copy is Russian and calm. Headers are Лекарство / Кол-во / Цена / Сумма and the total row is Итого. "Состав заказа скрыт настройками." covers the hidden-items case.
- Product rules: no client price, delivery fee, profit or identity is rendered (allowlist view). There are no destructive controls.
- Accessibility: the table uses th scope="col" and scope="row". The date is in a <time> element. Status is shown as text, not colour only. The table scrolls horizontally inside the card at 360 px with min-width 320 px, and names wrap. The actions footer is hidden when empty. There are no new interactive controls, so touch targets are not affected.
- Colours: red is for Новый and a wait of 20 min or more, amber for 10–19 min, green for the total. Contrast looks fine.

Notes (non-blocking)
- WaitingMinutes.tsx:24 `role="status"` is a polite live region on every card, updating every 30 s. With 20 cards, screen readers will announce a lot. Consider dropping the role, or keeping it only for the urgent level.
- PharmacyOrderCard.tsx:50 If `medicines` is an empty array the table has a header and no rows. Show the "Состав заказа скрыт настройками." line, or a different one, for length 0.
- PharmacyOrderCard.tsx:56 If the total is present but items are hidden, the total is not shown. This is acceptable now, but worth knowing.
- `.pharmacy-order-status` is a pill with no role. This is fine.

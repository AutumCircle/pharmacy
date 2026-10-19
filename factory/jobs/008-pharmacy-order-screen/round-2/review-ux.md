VERDICT: PASS

Scope: user-facing change on /staff/orders for the pharmacy role (PharmacyOrderCard.tsx, WaitingMinutes.tsx, staff.css). Round 2 makes client fields follow the pharmacy_web policy.

Checks
- Flow: card per order, plus the empty list state, refresh and pagination, all still work. Nothing dead-ends.
- States: "В заказе нет позиций." (empty), "Состав заказа скрыт настройками." (hidden) and an old Lambda response (no badge, no prices) are all handled. An invalid date does not crash.
- Copy is Russian, short and calm. Client fields appear only when the key is present, so default OFF means they are not shown.
- Product rules: no delivery fee in the totals. The card has no add-to-cart or destructive controls. Client sum and profit are shown only when the owner enables them.
- Accessibility: the table uses th scope, the date is in a <time> element, status is text and not colour alone, the dl pairs dt/dd. The `role="status"` on the badge was removed, so there is no live-region chatter. The table scrolls inside its card at 360 px and names wrap.

Notes (non-blocking)
- PharmacyOrderCard.tsx:60-63 If prices are hidden but base_total is present, the total sits under the "Кол-во" column, because colSpan is 1. This is an unlikely policy combination. Consider hiding the total row unless `priceColumns` is true, or add a "Сумма" column for it.
- PharmacyOrderCard.tsx:41 The `tel:` link is inline text with a height of about 20 px. When it is enabled, add `display:inline-block; padding:10px 0` in `.pharmacy-order-client a` for a 44 px touch target.
- The unmodified-row "Клиенту" column header and the "Разница" label are internal wording. Check them with the owner when the toggles are first enabled.

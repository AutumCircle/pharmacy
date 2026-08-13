# Pharmacy Vatan V4 — UI/UX Design Specification

**Status:** Design brief v1.0
**Source of truth:** `PRODUCT.md` and `API_CONTRACT.md`
**Purpose:** This document can be sent directly to a UI/UX or design-generation agent to create the complete public website and admin-panel design.

## 1. Product summary

Pharmacy Vatan V4 is a Russian-language online pharmacy catalogue for Tajikistan. A customer searches for medicines, saves favourites, adds available medicines to a local cart, places a cash-on-delivery order without registration, and tracks orders by phone number. Pharmacy employees process orders, manage categories, inspect the catalogue, resolve duplicate-source records, and review catalogue synchronizations.

The interface must feel trustworthy, calm, fast, and practical. It is a pharmacy service, not a promotional marketplace. Avoid visual noise, aggressive sales patterns, countdowns, unsupported discounts, medical claims, and unnecessary animation.

## 2. Mandatory product rules visible in the design

- The primary interface language is Russian. API identifiers remain English but are not shown to ordinary customers.
- Every medicine is internally identified by `medicine_id`; public links and cart state must use this ID even when the ID is not visually displayed.
- Customer price is supplied by the backend and represents `ceil(base price × 1.05)`.
- Orders below **50 TJS** cannot be placed.
- The pharmacy does not calculate, collect, or add a delivery fee.
- Checkout must display: **«Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке»**.
- `order_total` contains medicines only. Never show a fixed delivery fee or add delivery to the total.
- The only MVP payment method is payment for medicines upon delivery. There are no card fields, online-payment buttons, or payment-provider logos.
- Phone-only order tracking is used in MVP.
- Out-of-stock medicines cannot be added to the cart.
- Admin users cannot edit historical order prices or order composition.
- The design must never contain `wipe_db`, `delete_all_orders`, `cleanup_archive`, “delete all”, arbitrary SQL, credential-management, or mass-destruction controls.

## 3. Design deliverables

The design agent should produce:

1. A reusable component library and design tokens.
2. Desktop frames at **1440 px** width and mobile frames at **390 px** width for every public page.
3. Desktop frames at **1440 px** and responsive tablet/mobile behavior for every admin page.
4. Loading, empty, validation, error, disabled, success, and permission-denied states.
5. A clickable prototype for these critical flows:

   - search → medicine → cart → checkout → success → tracking;
   - admin login → orders → order details → status update;
   - admin categories → category editor → add medicine;
   - admin synchronization history → failed synchronization details.

6. Component names and states suitable for implementation in Next.js.

## 4. Visual direction

### 4.1 Brand personality

- Trustworthy and clinical, but not cold.
- Modern community pharmacy rather than a hospital dashboard.
- Clear hierarchy, generous whitespace, and strong readability.
- Product information and availability are more important than decoration.

### 4.2 Colour system

Use the current Vatan red as the brand anchor:

| Token | Value | Usage |
|---|---|---|
| `brand-primary` | `#E31E24` | Primary CTA, active navigation, key accents |
| `brand-primary-hover` | `#B71C1C` | Hover/pressed state |
| `brand-soft` | `#FFEBEE` | Selected filters, soft alerts, active admin navigation |
| `surface-page` | `#F8F9FA` | Public page background |
| `surface-admin` | `#F5F5F7` | Admin workspace background |
| `surface-card` | `#FFFFFF` | Cards, tables, modals |
| `text-primary` | `#2D2F33` | Main text |
| `text-secondary` | `#6C757D` | Supporting text |
| `border` | `#E0E0E0` | Dividers and controls |
| `success` | `#2E7D32` | In stock, completed, successful sync |
| `warning` | `#ED6C02` | Pending action, partial warning |
| `info` | `#1565C0` | Confirmed/information |
| `danger` | `#C62828` | Errors, cancelled, out of stock |

Red is not used for ordinary destructive controls because destructive data operations do not exist in the product. It is primarily the brand colour.

### 4.3 Typography

- Use a highly readable Cyrillic-compatible sans-serif such as **Inter**, with system sans-serif fallback.
- Page title: 28–32 px public, 26–30 px admin.
- Section title: 22–24 px.
- Card title/body: 14–16 px.
- Minimum mobile body size: 14 px.
- Prices use tabular numerals where available.
- Avoid all-uppercase paragraphs; uppercase is allowed only for compact table labels.

### 4.4 Shape, spacing, and elevation

- Base spacing unit: 4 px; common gaps: 8, 12, 16, 24, 32, 40 px.
- Public cards: 14–16 px radius.
- Form controls and buttons: 8–10 px radius.
- Chips and statuses: pill radius.
- Shadows are subtle; rely mainly on surface and border separation.
- Public content max width: 1200 px.
- Admin content max width: fluid, with a practical readable limit around 1440 px.

### 4.5 Icons and imagery

- Use one consistent outline icon set, such as Lucide. Do not mix emojis with interface icons.
- Icons always have text labels for important actions.
- Medicine imagery is optional. When absent, use a clean neutral medicine-package placeholder, not a random stock photo.
- Do not imply medical effectiveness through imagery.

## 5. Shared interaction rules

- Primary button: solid red; one dominant primary action per section.
- Secondary button: white with neutral border.
- Tertiary action: text/icon button.
- Disabled controls remain readable and explain why when necessary.
- Inputs have visible labels; placeholders never replace labels.
- Validation appears below the relevant field and in a form-level summary when submission fails.
- All asynchronous buttons show an inline spinner and prevent double submission.
- Success/error toasts may confirm small actions, but critical outcomes remain visible in page content.
- Modal dialogs are used only for short focused tasks. Complex order/category details use full pages or drawers.
- Focus rings must be clearly visible. Interactive targets are at least 44 × 44 px on mobile.
- Never rely on colour alone for status; use an icon and text label.

## 6. Public application shell

### 6.1 Desktop header

The header is sticky and contains, from left to right:

1. Vatan Pharmacy logo linking to `/`.
2. Primary navigation button **«Каталог»** linking to `/catalog`.
3. Large search field with placeholder **«Найти лекарство»** and search icon button.
4. Action **«Избранное»** with item count when greater than zero.
5. Action **«Мои заказы»** linking to `/tracking`.
6. Action **«Корзина»** with total item-count badge.

Below the main header, show a horizontally scrollable category strip. The first item is **«Все товары»**, followed by active categories. Active category uses the brand colour.

Do not include an account/avatar button because customer accounts are outside MVP.

### 6.2 Mobile header and bottom navigation

Mobile header:

- Compact logo on the left.
- Cart icon with count on the right.
- Full-width search field on the second row.

Fixed bottom navigation with five labelled items:

- **Главная**
- **Каталог**
- **Корзина**
- **Заказы**
- **Избранное**

The active item must reflect the actual route. Leave enough bottom safe-area spacing on iOS.

### 6.3 Public footer

Simple footer containing:

- Vatan Pharmacy name/logo.
- Short service description.
- Links: **«Каталог»**, **«Мои заказы»**, **«Условия заказа»**.
- Pharmacy contact telephone and working hours when provided by the owner.
- Legal/privacy links as placeholders until final content is supplied.

Do not invent addresses, phone numbers, licences, or regulatory claims.

## 7. Shared public components

### 7.1 Medicine card

Each card contains:

- Optional image or neutral placeholder.
- Favourite heart icon in the upper-right corner.
- Medicine name, maximum three lines.
- Vendor and country when present.
- Customer selling price, visually prominent.
- Availability label.
- Primary button **«В корзину»** for available medicine.
- When already in cart: compact minus / quantity / plus stepper and link/icon to cart.

Out-of-stock state:

- Muted visual treatment without making text unreadable.
- Badge **«Нет в наличии»**.
- Disabled button **«Недоступно»**.
- Favourite action remains available.

The public card does not show base price, internal sync information, or `medicine_id` as visible text.

### 7.2 Search autocomplete

After two characters, show a desktop dropdown or mobile full-width result panel:

- Medicine name.
- Vendor/country as secondary text.
- Selling price.
- Availability.
- Keyboard-highlight state.
- Final row **«Показать все результаты»**.

States: loading skeleton, no matches, request failed with **«Повторить»**.

### 7.3 Quantity stepper

- Minus button, numeric quantity, plus button.
- Minimum one while item remains in cart.
- At one, minus removes the item only after a small confirmation/undo pattern.
- Changes immediately update the displayed subtotal estimate.

### 7.4 Status badges

Customer labels:

| API status | Russian label | Colour |
|---|---|---|
| `pending` | В обработке | Warning |
| `confirmed` | Подтверждён | Info |
| `delivering` | В пути | Brand/info |
| `delivered` | Доставлен | Success |
| `cancelled` | Отменён | Danger |

## 8. Public pages

### 8.1 Home and search page — `/`

#### Purpose

Help customers search quickly and enter the catalogue. The home page must be useful without promotional banners.

#### Desktop layout

1. Shared header and category strip.
2. Intro block with heading **«Лекарства рядом — быстро и удобно»** and supporting text explaining ordering without online payment.
3. Prominent search input. It may reuse the header search on mobile but should remain visually dominant.
4. Compact three-benefit row:

   - **«Актуальное наличие»**
   - **«Заказ без регистрации»**
   - **«Оплата при получении»**

5. Section **«Каталог лекарств»** with available medicine cards and pagination or **«Показать ещё»**.

Do not add unsupported “discount”, “popular”, or recommendation sections.

#### Search-results state

When the URL contains a query:

- Replace the intro block with heading **«Результаты поиска»**.
- Show query text and result count.
- Provide **«Очистить поиск»**.
- Keep category/filter navigation available.

#### States

- Initial loading: card skeleton grid.
- No results: search illustration, **«Ничего не найдено»**, spelling suggestion, **«Очистить поиск»**.
- Error: inline error panel with **«Повторить»**.

#### Mobile

- Intro text is shorter.
- Benefit items become a horizontal scroll row or stacked cards.
- Medicine cards use a two-column grid down to approximately 360 px; use one column if content becomes cramped.

### 8.2 Full catalogue — `/catalog`

#### Header area

- Breadcrumb: **«Главная / Каталог»**.
- Title **«Каталог лекарств»**.
- Result count.

#### Controls

- Search within catalogue.
- Category chips/dropdown.
- Sorting dropdown: **«По названию»**, **«Сначала дешевле»**, **«Сначала дороже»** only if supported by API.
- Availability filter is unnecessary for ordinary catalogue because sellable items are the default.
- Button **«Сбросить фильтры»** appears only when filters are active.

#### Content

- Medicine-card grid.
- Cursor-based pagination represented as **«Назад»** and **«Далее»**, or **«Показать ещё»** if technically preferred.
- Preserve filters when navigating pages.

#### Mobile

- Filters open in a bottom sheet with **«Применить»** and **«Сбросить»**.
- Sorting remains a compact select/button above the grid.

### 8.3 Category page — `/category/[slug]`

- Breadcrumb: **«Главная / Каталог / {Название категории}»**.
- Category name, optional icon, and result count.
- Same search, sorting, cards, pagination, and states as catalogue.
- Active category remains selected in the shared category strip.
- Empty category state: **«В этой категории пока нет доступных товаров»** and button **«Перейти в каталог»**.

### 8.4 Medicine details — target route `/medicine/[medicine_id]`

The final design and implementation should use `medicine_id`, even if a legacy route currently uses the name.

#### Desktop layout

Two-column layout:

- Left: image/placeholder panel.
- Right: medicine information and purchase card.

#### Content

- Breadcrumb.
- Medicine name as H1.
- Availability badge.
- Vendor and country.
- Customer selling price.
- Optional “catalogue updated” supporting text, without technical sync IDs.
- Quantity selector and primary **«В корзину»**.
- Favourite button **«В избранное»** / **«В избранном»**.

Below, display a section **«Информация о товаре»** with only fields actually supplied by the API. Do not invent indications, contraindications, dosage instructions, or medical advice.

#### Out-of-stock state

- Show **«Нет в наличии»**.
- Hide/disable quantity and cart CTA.
- Keep favourite action.
- Suggest **«Вернуться в каталог»**, not automatic medical alternatives.

#### Mobile

- Single column.
- Sticky bottom purchase bar containing price and cart CTA for available medicine.

### 8.5 Favourites — `/favorites`

#### Content

- Title **«Избранное»** and count.
- Medicine-card grid.
- Out-of-stock saved medicines remain visible with disabled purchase CTA.
- Per-card remove action and optional top action **«Очистить избранное»** with confirmation.

#### Empty state

- Heart illustration/icon.
- Text **«В избранном пока ничего нет»**.
- Button **«Перейти в каталог»**.

### 8.6 Cart and checkout — `/cart`

This route has three visual states: cart, checkout form, and successful submission.

#### Cart state

Desktop uses two columns.

Left column:

- Title **«Корзина»** and item count.
- Rows with medicine image, name, vendor/country, unit selling price, quantity stepper, line total, and **«Удалить»** icon/button.
- Optional link **«Продолжить покупки»**.

Right summary card:

- **«Товары»** subtotal.
- **«Итого»** equal to medicines subtotal.
- Prominent delivery notice: **«Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке»**.
- No delivery-price row and no grand total including delivery.
- Primary button **«Перейти к оформлению»**.

If subtotal is below 50 TJS:

- Show progress/notice: **«Минимальная сумма заказа — 50 TJS. Добавьте товаров ещё на {amount} TJS»**.
- Disable checkout CTA.

#### Checkout state

Left/form column:

- Back button **«Вернуться в корзину»**.
- Fields: **«Имя»**, **«Телефон»**, **«Адрес доставки»**, **«Комментарий к заказу»**.
- Phone field has `+992` prefix guidance and inline formatting.
- Required fields are visibly marked.
- Payment card: selected non-interactive option **«Оплата лекарств при получении»**.
- Delivery information panel with approved delivery notice.

Right summary:

- Compact order-item list.
- Medicines subtotal and order total only.
- Primary button **«Оформить заказ»**.
- Supporting text: **«Мы позвоним вам для подтверждения заказа»**.

Submission states:

- Button becomes **«Оформляем…»** and cannot be double-clicked.
- If a medicine becomes unavailable, show an actionable item-level error and button **«Обновить корзину»**.
- If server subtotal is below 50 TJS, return to cart summary with the server-calculated amount.
- Preserve customer input after recoverable errors.

#### Success state

- Success icon and heading **«Заказ оформлен»**.
- Show `order_reference`, medicines total, status **«В обработке»**, and confirmation-call notice.
- Repeat the delivery notice without a delivery amount.
- Buttons:

  - Primary **«Отследить заказ»** → `/tracking`.
  - Secondary **«Вернуться на главную»**.

#### Empty cart

- Cart icon/illustration.
- **«Ваша корзина пуста»**.
- Button **«Перейти в каталог»**.

#### Mobile

- Item rows become compact cards.
- Summary/checkout CTA is sticky above bottom navigation.
- Forms use one column and native-friendly input sizes.

### 8.7 Order tracking — `/tracking`

#### Initial state

- Title **«Мои заказы»**.
- Explanation: **«Введите номер телефона, указанный при оформлении заказа»**.
- Phone input with `+992` guidance.
- Primary button **«Найти заказы»**.
- Short privacy note; do not mention internal rate-limit mechanics.

#### Results layout

Desktop uses master/detail:

- Left: order list sorted newest first.
- Right: selected order details.

Order list item:

- Order reference.
- Creation date.
- Status badge.
- Medicines total.

Order detail:

- Order reference and date.
- Four-step progress component: **«В обработке» → «Подтверждён» → «В пути» → «Доставлен»**.
- Cancelled orders replace the progress bar with a clear cancelled panel.
- Item list with medicine name, quantity, selling price snapshot, and line total.
- **«Итого за лекарства»** / `order_total`.
- Delivery notice with no price.
- Masked customer information only if returned by the public API.

Actions:

- **«Выбрать другой заказ»** when multiple orders exist.
- **«Сменить номер телефона»** clears the local tracking state.
- Optional **«Обновить статус»** refresh button.

States:

- Loading skeleton.
- No orders: neutral **«Заказы для этого номера не найдены»**.
- Rate limited: **«Слишком много запросов. Попробуйте позже»**.
- Error: **«Не удалось загрузить заказы»** with **«Повторить»**.

Mobile uses an order list followed by a full-screen/detail page or expandable cards; avoid a cramped two-column layout.

### 8.8 Not found and system error

#### 404

- Heading **«Страница не найдена»**.
- Short explanation.
- Primary **«На главную»** and secondary **«Открыть каталог»**.

#### Application error

- Heading **«Что-то пошло не так»**.
- Non-technical explanation.
- Primary **«Повторить»** and secondary **«На главную»**.
- Never expose request payloads, stack traces, credentials, or SQL.

## 9. Admin application shell

### 9.1 Desktop navigation

Persistent left sidebar, approximately 248–264 px wide:

- Vatan Admin logo/title.
- **«Дашборд»**
- **«Заказы»** with active-order count badge.
- **«Лекарства»**
- **«Дубли»**
- **«Категории»**
- **«Синхронизации»**
- Bottom user/role area and **«Выйти»**.

Use consistent outline icons, not emoji. Active item uses `brand-soft` background and red text/icon.

### 9.2 Admin top bar

- Current page title or breadcrumb.
- Optional global search only if it searches real supported entities.
- Current role badge: **«Администратор»** or **«Наблюдатель»**.
- User/session menu with **«Выйти»**.

### 9.3 Responsive admin behavior

- At tablet width, sidebar collapses to icons and may expand as a drawer.
- At mobile width, use a top app bar and navigation drawer.
- Tables become horizontally scrollable or transform into labelled cards.
- Critical order-processing actions remain usable on tablet/mobile.

### 9.4 Role presentation

- `viewer`: all mutation buttons are hidden or disabled with tooltip **«Недостаточно прав»**.
- `admin`: can update order status and manage categories.
- Neither role can edit source-controlled medicine prices/availability or perform destructive database operations.

## 10. Admin pages

### 10.1 Admin login — `/admin/login`

Centered authentication card on a calm neutral background.

Card content:

- Vatan Admin logo.
- Heading **«Вход в панель управления»**.
- Labelled password/credential fields required by the final auth method.
- Show/hide-password control.
- Primary button **«Войти»**.
- Loading state **«Входим…»**.
- Generic error **«Не удалось войти. Проверьте данные»**.

Do not display default credentials, API keys, infrastructure names, or technical error details.

### 10.2 Admin dashboard — `/admin`

#### Header

- Title **«Панель управления»**.
- Supporting line **«Каталог обновлён {relative time}»**.
- If the latest sync failed, show an alert linking to sync details.

#### KPI cards

Each card is clickable and opens a filtered destination:

- **«Всего лекарств»**
- **«В наличии»**
- **«Нет в наличии»**
- **«Группы дублей»**
- **«Активные заказы»**
- **«Активные категории»**

#### Operational sections

- **«Новые заказы»**: latest pending orders with **«Открыть»**.
- **«Последняя синхронизация»**: status, time, processed/in-stock/out-of-stock/error counts, **«Подробнее»**.
- **«Системные предупреждения»** only when real data fails or attention is needed.

Do not show revenue charts unless their definition and data source are approved. All displayed order totals exclude delivery.

### 10.3 Orders list — `/admin/orders`

#### Header and tools

- Title **«Заказы»**.
- Search by order reference, exact phone, or customer name.
- Date-range filter.
- Status tabs/chips:

  - **«Все»**
  - **«Новые»**
  - **«Подтверждённые»**
  - **«В пути»**
  - **«Доставленные»**
  - **«Отменённые»**

- Button **«Сбросить фильтры»** when needed.

#### Desktop table

Columns:

- Order reference.
- Created date/time.
- Customer.
- Masked/authorized phone presentation.
- Item count.
- Medicines total.
- Status.
- Last update.
- Action **«Открыть»**.

Rows are clickable. Do not place a status-changing select directly in every table row; status transitions belong in order details to reduce mistakes.

#### States

- Loading skeleton rows.
- Empty filtered state with **«Сбросить фильтры»**.
- Error with **«Повторить»**.
- Cursor pagination controls.

### 10.4 Order details — `/admin/orders/[order_id]`

#### Top area

- Breadcrumb **«Заказы / {order_reference}»**.
- Order reference, created time, and status badge.
- Secondary button **«Назад к заказам»**.

#### Main layout

Left/main column:

- Customer card: name, phone with copy button, address with copy button, optional comment.
- Order-items table: `medicine_id`, snapshot name, quantity, base-price snapshot, selling-price snapshot, line total.
- Summary: medicines subtotal and order total only.
- Delivery-policy info panel: fee is agreed and paid directly to courier; no amount field.

Right/action column:

- **«Изменить статус»** card showing current state and only allowed next actions.
- For `pending`: **«Подтвердить заказ»**, **«Отменить»**.
- For `confirmed`: **«Передать в доставку»**, **«Отменить»**.
- For `delivering`: **«Отметить доставленным»**.
- For terminal states: no mutation CTA.

Cancellation opens a modal requiring **«Причина отмены»**, with **«Не отменять»** and destructive-looking but scoped **«Отменить заказ»**.

#### History

Vertical timeline showing old/new status, actor, date/time, and cancellation reason. History is read-only.

Concurrency/error states:

- If status changed elsewhere, show **«Статус заказа уже изменён»**, refresh details, and require a new choice.
- Mutation error leaves the current confirmed server status visible.

### 10.5 Medicines — `/admin/medicines`

This is a read-oriented catalogue inspection page. Source-controlled fields are not edited here.

#### Controls

- Search by medicine name, `medicine_id`, vendor, country, and `source_sku` when available.
- Availability tabs: **«Все»**, **«В наличии»**, **«Нет в наличии»**.
- Optional sort: updated date, name, base price.
- Result count.

#### Table columns

- `medicine_id`.
- Medicine name.
- Base price.
- Calculated selling price.
- Country/vendor.
- Availability.
- Last updated.
- Duplicate/conflict indicator when relevant.

Row click may open a read-only details drawer containing source identity, normalized identity, timestamps, category memberships, and sync metadata safe for admin display.

Do not provide controls to edit `medicine_id`, base price, source identity, or synchronized availability.

### 10.6 Duplicate groups — `/admin/duplicates`

Purpose: inspect records with overlapping names or merged fallback identities without assuming they are the same medical product.

#### Controls and table

- Search by medicine name.
- Filter **«Требуют внимания»** / **«Объединены автоматически»** if backend provides this distinction.
- Columns: normalized/group name, record count, available count, price range, vendors/countries, latest sync, action **«Проверить»**.

Empty state: **«Группы дублей не найдены»**.

### 10.7 Duplicate details — `/admin/duplicates/[group_key]`

- Breadcrumb and group title.
- Explanation of the fallback identity and deterministic merge rule.
- Summary card: selected canonical `medicine_id`, source-row count, selected base price, availability result.
- Comparison table containing source row number, raw name, vendor, country, base price, `*` availability marker, normalized identity, and selection reason.
- Audit panel explaining which row won: available first → maximum base price → first source row.

This page is read-only in MVP unless a future backend contract explicitly defines manual resolution. Do not invent a “merge” mutation button.

### 10.8 Categories — `/admin/categories`

#### List view

- Title **«Категории»**.
- Primary button **«Создать категорию»** for admin role.
- Search by name/slug.
- Active/inactive filter.
- Table/cards: icon, name, slug, medicine count, active status, updated date, **«Редактировать»**, **«Товары»**.

#### Create/edit drawer or modal

Fields:

- **«Название»**.
- **«Slug»**; editable only during creation.
- **«Иконка»** chosen from an approved icon picker, not arbitrary HTML.
- **«Цвет»** from controlled palette/hex validation.
- **«Активная категория»** switch.

Buttons: **«Отмена»**, **«Создать»** or **«Сохранить»**.

There is no permanent delete button. Deactivation uses confirmation: **«Отключить категорию?»**.

#### Category medicines manager

- Category header and **«Назад к категориям»**.
- Current medicines list with `medicine_id`, name, availability, and **«Убрать»**.
- Search/select medicine control searching by ID or name.
- Primary **«Добавить товар»**.
- Out-of-stock medicines remain visible so their relationship can be removed.
- Prevent duplicate relationships and explain the validation inline.

### 10.9 Synchronization history — `/admin/history`

Rename the visible navigation label to **«Синхронизации»** even if the technical route remains `/admin/history`.

#### List

- Title **«История синхронизаций»**.
- Status filters: all, running, succeeded, failed.
- Date filter.
- Each sync card/row displays:

  - `sync_id` with copy button;
  - status badge;
  - created/completed time and duration;
  - received rows;
  - inserted/updated/unchanged counts when available;
  - in-stock/out-of-stock counts;
  - merged duplicate count;
  - error count;
  - **«Подробнее»**.

#### Sync details

- Progress/state timeline: created → uploaded → validating → applying → succeeded/failed.
- File metadata and checksum, but never pre-signed URLs or credentials.
- Summary metrics.
- Safe validation errors with source row number and reason.
- Merged-row report.
- Button **«Скачать отчёт»** only if a safe report endpoint exists.

There is no “run wipe”, “cleanup archive”, or database-delete button. If manual sync triggering is not part of the approved API, do not design a **«Запустить синхронизацию»** button.

## 11. Global UI states

### Loading

- Prefer structural skeletons matching final layout.
- Use spinners inside buttons for short mutations.
- Avoid blocking the entire application for a local panel refresh.

### Empty

- State what is empty, why it may be empty, and offer one safe next action.
- Do not present a destructive action as the empty-state solution.

### Error

- Human-readable Russian message.
- Safe retry/back action.
- Optional short request ID for support.
- No stack traces, SQL, secrets, raw phone/address, or AWS details.

### Offline/timeout

- Preserve user-entered checkout data.
- Show **«Нет соединения. Проверьте интернет и повторите»**.
- Never silently submit a mutation multiple times.

### Permission denied

- Show **«Недостаточно прав для этого действия»**.
- Preserve read access where the role permits it.

## 12. Accessibility and content requirements

- Target WCAG 2.1 AA contrast.
- Full keyboard navigation for search, filters, tables, modals, and status actions.
- Use semantic headings, form labels, table headers, and status announcements.
- Add accessible names to icon-only controls.
- Respect reduced-motion preferences.
- Validation is announced and linked to fields.
- Dates use Russian locale and explicit timezone policy from implementation.
- Currency formatting is consistent: customer UI may use **«25 TJS»**; admin base prices use two decimals, for example **«23.50 TJS»**.
- Never make medical claims or display generated dosage/health instructions.

## 13. Responsive breakpoints

Use content-driven behavior around these reference widths:

- Mobile: 360–479 px.
- Large mobile/small tablet: 480–767 px.
- Tablet: 768–1023 px.
- Desktop: 1024–1439 px.
- Large desktop: 1440 px and above.

Public medicine grid target:

- Mobile: 2 columns when readable, otherwise 1.
- Tablet: 3 columns.
- Desktop: 4–5 columns depending on available width.

Admin tables must not compress critical information into unreadable columns. Use horizontal scrolling or card conversion.

## 14. Design-agent restrictions

The design agent must not introduce:

- customer registration/account flows;
- online payment or bank-card forms;
- a fixed or estimated pharmacy delivery fee;
- prescription advice or automatic medicine substitutions;
- unapproved discounts, promotional banners, loyalty points, or coupons;
- manual editing of synchronized medicine price/availability/identity;
- deleting all orders, clearing archives, wiping the database, arbitrary SQL, or credentials pages;
- public base prices, sync internals, full phone numbers, or full addresses in tracking;
- unsupported analytics or revenue definitions.

If required data/action is not defined in this document, the design should mark it as a question rather than inventing it.

## 15. Acceptance checklist for the design

- Every route in sections 8 and 10 has desktop and mobile/responsive treatment.
- Critical customer and admin flows are prototyped.
- `medicine_id` is used structurally; medicine names are display content.
- Checkout and tracking never add a delivery fee.
- Minimum order state at 50 TJS is designed.
- All order-status transitions and terminal states are represented.
- Admin mutation controls respect `admin` and `viewer` roles.
- No destructive database or bulk-order controls exist.
- Loading, empty, error, success, disabled, and permission states exist.
- Components use reusable variants rather than page-specific visual copies.
- Public and admin experiences share the brand but remain visually distinct.
- The final design is implementable with Next.js and the approved API v1 without inventing backend capabilities.

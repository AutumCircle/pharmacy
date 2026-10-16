# Pharmacy Vatan V4 — API Contract v1

**Status:** Approved specification v1.0; implementation pending Phase 2
**Scope:** Next.js → API Gateway → Python Lambda → RDS PostgreSQL
**Base path:** `/v1`

Homepage content routes:

- `GET /v1/public/homepage-banners` — active homepage banner metadata.
- `GET /v1/admin/homepage-banners` — all four banner slots (admin authorization required).
- `PATCH /v1/admin/homepage-banners/{slot}` — update title, subtitle, HTTPS image URL, link, or active state.
- `GET /v1/public/product-carousels` — active carousel sections in configured order with their available products.
- `GET|POST /v1/admin/product-carousels` — list compact carousel metadata (`product_count`) or create a section.
- `PATCH|DELETE /v1/admin/product-carousels/{carousel_id}` — edit, activate/deactivate, reorder, or delete a section.
- `PATCH /v1/admin/product-carousels/reorder` — save the complete section order in one transaction.
- `GET /v1/admin/product-carousels/{carousel_id}/products` — numbered, searchable product page.
- `GET /v1/admin/product-carousels/{carousel_id}/candidates` — numbered candidate search with `already_present`.
- `POST|DELETE /v1/admin/product-carousels/{carousel_id}/products/batch` — set-based add/remove of 1–100 relationships.
- `PATCH /v1/admin/product-carousels/{carousel_id}/products/reorder-page` — reorder one unfiltered page while preserving its sort slots.
- `POST /v1/admin/product-carousels/{carousel_id}/products` — add a unique product by `medicine_id`.
- `PATCH|DELETE /v1/admin/product-carousels/{carousel_id}/products/{medicine_id}` — update product order/image or remove it from the section.
- `GET /v1/public/featured-products` and the matching admin routes remain temporary compatibility endpoints during rollout.

## 1. Цель

Контракт заменяет общий `POST /api/query` с произвольным полем `action` на явные routes, HTTP methods, request schemas и отдельные права.

Критическое изменение checkout: frontend больше не отправляет `price`, `sellPrice`, `basePrice`, `subtotal`, `delivery_fee` или `total`. В каждой позиции он отправляет только `medicine_id` и `quantity`. Lambda получает лекарство и текущую базовую цену из RDS по `medicine_id`, применяет `ceil(base_unit_price × 1.05)` и сохраняет рассчитанные snapshots.

Legacy actions приведены только для migration mapping. После перехода общий action router должен быть отключён.

## 2. Границы доверия

```text
Browser
  └─ same-origin /api/*
       Next.js route handler / server action
         └─ API Gateway /v1/*
              └─ Python Lambda
                   └─ parameterized SQL / transaction
                        RDS PostgreSQL
```

- Browser и `localStorage` недоверенны; клиентские цены, totals, роли и статусы игнорируются.
- Browser не получает AWS URL или credentials. `API_KEY` остаётся server-only; `NEXT_PUBLIC_API_KEY` запрещена.
- Next.js вызывает только фиксированный upstream route и проверяет пользовательскую/admin session.
- API Gateway разделяет public, admin и internal sync routes, authorizers, throttling и logs.
- Lambda повторно валидирует payload и permission. UI/middleware/API key сами по себе не являются admin authorization.
- Только Lambda выполняет SQL. Next.js и `agent_sync.exe` не получают RDS credentials.

## 3. Общие правила

- HTTPS и JSON UTF-8; timestamps — ISO 8601 UTC.
- Customer-facing суммы — целые TJS после утверждённого округления. В RDS денежные значения хранятся как точный decimal, не float.
- Неизвестные поля mutation request отклоняются с `400 VALIDATION_ERROR`.
- Каждый ответ содержит `request_id`.
- List endpoints имеют `limit` (default 20, max 100), opaque `cursor` и deterministic ordering.
- Long admin category/carousel membership lists use numbered `page`/`limit` pagination and return `number`, `size`, `total_items`, `total_pages`.
- Фильтрация, сортировка, pagination и aggregation выполняются в Lambda/RDS, не после загрузки всей таблицы в Next.js.
- `POST /public/orders` требует UUID в `Idempotency-Key`.

Успешный list response:

```json
{
  "data": [],
  "page": {
    "next_cursor": null,
    "has_more": false
  },
  "request_id": "req_01J..."
}
```

## 4. Route map

### 4.1 Public

| Method и route | Назначение | Legacy action |
|---|---|---|
| `GET /v1/public/medicines/search` | Поиск лекарств | `search` |
| `GET /v1/public/medicines/{medicine_id}` | Получение лекарства | `get` |
| `GET /v1/public/categories` | Активные категории | `list_categories` |
| `GET /v1/public/categories/{slug}/medicines` | Пагинированные доступные товары категории | `get_category_medicines` |
| `POST /v1/public/orders` | Создание заказа | `create_order` |
| `POST /v1/public/orders/track` | Tracking по точному телефону | Новая операция вместо `list_orders` |

### 4.2 Admin

| Method и route | Назначение | Legacy action |
|---|---|---|
| `GET /v1/admin/orders` | Пагинированный список заказов | `list_orders` |
| `GET /v1/admin/orders/{order_id}` | Заказ и status history | Новая операция |
| `PATCH /v1/admin/orders/{order_id}/status` | Разрешённый переход статуса | `update_order` |
| `DELETE /v1/admin/orders/{order_id}` | Soft-delete нового/отменённого заказа | Новая операция |
| `GET /v1/admin/categories` | Все категории | `list_categories` |
| `POST /v1/admin/categories` | Создать категорию | `create_category` |
| `PATCH /v1/admin/categories/{category_id}` | Изменить/отключить | `update_category` |
| `DELETE /v1/admin/categories/{category_id}` | Удалить только неиспользуемую категорию | Новая операция |
| `PATCH /v1/admin/categories/reorder` | Сохранить полный порядок категорий одной транзакцией | Новая операция |
| `GET /v1/admin/categories/{category_id}/medicines` | Пагинированные связи категории с поиском/availability | Новая операция |
| `GET /v1/admin/categories/{category_id}/medicines/candidates` | Пагинированный поиск кандидатов с `already_present` | Новая операция |
| `POST\|DELETE /v1/admin/categories/{category_id}/medicines/batch` | Добавить/удалить 1–100 выбранных связей set-based | Новая операция |
| `PUT /v1/admin/categories/{category_id}/medicines/{medicine_id}` | Добавить связь | `add_category_medicine` |
| `DELETE /v1/admin/categories/{category_id}/medicines/{medicine_id}` | Удалить связь | `remove_category_medicine` |
| `GET /v1/admin/categories/{category_id}/medicines/bulk-preview` | Предпросмотр буквального поиска по фрагменту имени | Новая операция |
| `POST /v1/admin/categories/{category_id}/medicines/bulk-add` | Подтверждённое массовое добавление найденных связей | Новая операция |
| `GET /v1/admin/catalog-syncs` | История синхронизаций | `history` |

### 4.3 Internal sync

| Method и route | Назначение |
|---|---|
| `POST /v1/internal/catalog-syncs` | Создать `sync_id` и получить upload target |
| `POST /v1/internal/catalog-syncs/{sync_id}/commit` | Проверить upload и запустить import |
| `GET /v1/internal/catalog-syncs/{sync_id}` | Получить результат sync |

Internal routes используют отдельную machine identity `agent_sync`, не admin cookie и не public API key.

## 5. Public read contracts

### 5.1 Search

`GET /v1/public/medicines/search?q={query}&limit={limit}&cursor={cursor}`

- `q`: trimmed string, 2–120 символов.
- Публичный endpoint возвращает только sellable medicines; архив доступен только admin.
- Поиск в два этапа: PostgreSQL (`pg_trgm`, `LIKE` + `word_similarity >= 0.25`) отбирает до 400
  кандидатов, затем `backend/v1/shared/search_ranking.py` сортирует их по словам:
  точное слово > начало слова > слово с опечаткой (взвешенное расстояние Дамерау–Левенштейна,
  дешевле для а/о, е/и, удвоенных букв, ь/ъ). Слово названия лекарства весит больше, чем
  форма выпуска/единицы (`таб`, `капс`, `мг` …) и числа, поэтому опечатка в названии не проигрывает
  точному «таб» или «500». Латиница транслитерируется (`nurofen`), неверная раскладка исправляется
  (`gfhfwtnfvjk`), `ё`/таджикские буквы нормализуются, склеенные слова (`ношпа`) находят `Но-шпа`.
  Совсем нерелевантные кандидаты отбрасываются; если отброшено всё — возвращается порядок PostgreSQL.
  При равной релевантности: более короткое название, `medicine_name ASC`, `medicine_id ASC`.
  Пагинация — offset внутри этого пула (не более 400 результатов на запрос). Можно передать
  `page={n}` вместо `cursor`; `page` в ответе дополнительно содержит `number`, `size`,
  `total_items`, `total_pages`. Сайт запрашивает по 24 товара (делится на 2/3/4/6 колонок).
- `page.next_cursor` и `page.previous_cursor` — непрозрачные cursor для перехода вперёд и назад; клиент не разбирает их содержимое.
- В публичном UI техническое поле `medicine_id` отображается покупателю под названием «Артикул».
- `base_unit_price` никогда не возвращается публично.

Medicine response item:

```json
{
  "medicine_id": 1042,
  "medicine_name": "Аспирин Кардио тб 100мг №28",
  "selling_unit_price": 25,
  "currency": "TJS",
  "country": "Германия",
  "vendor": "Example Pharma",
  "in_stock": true,
  "catalog_updated_at": "2026-08-06T10:15:30Z"
}
```

### 5.2 Get medicine

`GET /v1/public/medicines/{medicine_id}`

- `medicine_id`: положительный integer, соответствующий primary key каталога. Внешний SKU, если он существует, хранится отдельно и однозначно сопоставляется с этим ID.
- `404 MEDICINE_NOT_FOUND` — совпадения нет.

### 5.3 Categories

- `GET /v1/public/categories?limit=20&cursor=...` возвращает активные `slug`, `name`, `icon`, `color`.
- `GET /v1/public/categories/{slug}/medicines?page=1&limit=24` возвращает только sellable medicines и numbered page: `number`, `size`, `total_items`, `total_pages`.
- Total считается по действующим `category_medicines.medicine_id` links, связанным с medicines в наличии; ordering: `medicine.name ASC, medicine.id ASC`.
- Неизвестная или отключённая категория возвращает `404 CATEGORY_NOT_FOUND`.

## 6. `create_order` — критический контракт

`POST /v1/public/orders`

Headers:

```http
Content-Type: application/json
Idempotency-Key: 2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32
```

Разрешённый request:

```json
{
  "customer_name": "Фируз",
  "phone": "917123456",
  "address": "Душанбе, ул. Айни 24",
  "comment": "Позвоните перед доставкой",
  "items": [
    {
      "medicine_id": 1042,
      "quantity": 2
    }
  ]
}
```

В item разрешены только `medicine_id` и `quantity`. Поля `medicine_name`, `price`, `sellPrice`, `basePrice`, `subtotal`, `delivery_fee`, `total`, `status`, `payment_status` и `role` запрещены на любом уровне request.

Validation:

- `customer_name`: 2–120 символов.
- `phone`: 9 местных цифр или `+992` E.164; в RDS сохраняется `+992XXXXXXXXX`.
- `address`: 5–500 символов.
- `comment`: optional, max 500 символов.
- `items`: 1–50 уникальных позиций.
- `medicine_id`: положительный integer, существующий в каталоге.
- `quantity`: integer, 1–99.
- Повторяющиеся `medicine_id` отклоняются с `DUPLICATE_ORDER_ITEM`.

Обязательный алгоритм Lambda:

1. Проверить caller, rate limit, schema и `Idempotency-Key`.
   - Текущая реализация: per-IP лимит попыток создания заказа применяется в Next.js route `POST /api/checkout` (см. §11), до вызова Lambda. Lambda-side лимит и лимит по hash телефона для create order пока не реализованы.
2. Повтор с тем же key и payload возвращает исходный response; тот же key с другим payload — `409 IDEMPOTENCY_CONFLICT`.
3. В одной DB transaction получить все позиции по primary key `medicine_id`.
4. Для каждой позиции потребовать ровно одну активную запись с `in_stock=true` и положительной `base_unit_price`.
5. Decimal arithmetic: `selling_unit_price = ceil(base_unit_price × 1.05)`.
6. Рассчитать `items_subtotal = Σ(selling_unit_price × quantity)` и проверить `items_subtotal >= 50`.
7. Установить server-owned значения: `order_total=items_subtotal`, `payment_method=cash_on_delivery`, `payment_status=unpaid`, `status=pending`. `delivery_fee` и `grand_total` не рассчитываются и не сохраняются.
8. Сохранить order, item snapshots (`medicine_id`, `medicine_name`, base/selling price, quantity) и первую status-history запись.
9. Commit и вернуть серверный итог. При ошибке заказ не создаётся частично.

Доставка находится вне денежного контракта заказа: аптека не задаёт и не получает её стоимость. Next.js checkout обязан показывать утверждённую копию: **“Delivery fee is calculated and paid directly to the courier upon delivery.”** Русская UI-локализация: **«Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке»**.

Response `201`:

```json
{
  "data": {
    "order_id": "ord_01J4N8W9K3...",
    "order_reference": "3456-105",
    "status": "pending",
    "payment_method": "cash_on_delivery",
    "payment_status": "unpaid",
    "currency": "TJS",
    "items": [
      {
        "medicine_id": 1042,
        "medicine_name": "Аспирин Кардио тб 100мг №28",
        "quantity": 2,
        "selling_unit_price": 25,
        "line_total": 50
      }
    ],
    "items_subtotal": 50,
    "order_total": 50,
    "created_at": "2026-08-06T10:15:30Z"
  },
  "request_id": "req_01J..."
}
```

Business errors:

| HTTP/code | Значение |
|---|---|
| `404 MEDICINE_NOT_FOUND` | Позиция не найдена |
| `409 ORDER_ITEMS_UNAVAILABLE` | Позиция уже не в наличии |
| `409 CATALOG_PRICE_INVALID` | Серверная базовая цена некорректна |
| `409 IDEMPOTENCY_CONFLICT` | Key повторён с другим payload |
| `422 MINIMUM_ORDER_NOT_REACHED` | Серверный subtotal меньше 50 TJS |

Item error возвращает только безопасные `medicine_id` и `code`; SQL, base price и внутренние детали не раскрываются.

## 7. Tracking contract

`POST /v1/public/orders/track`

Request:

```json
{
  "phone": "917123456"
}
```

- Только exact normalized phone match; suffix/substring matching запрещён.
- Endpoint выполняет parameterized filtered SQL с limit 20, а не вызывает admin `list_orders`.
- Одинаковая форма ответа используется для неизвестного номера и номера без заказов.
- Rate limit применяется по IP и hash нормализованного телефона; raw phone не пишется в access logs. Текущее состояние (только Next.js `src/app/api/tracking/route.ts` + `src/lib/tracking-guard.ts`, Lambda не меняется):
  - Ключ — client IP (первый адрес `x-forwarded-for`, затем `x-real-ip`, иначе общий bucket `unknown`). Guard проверяет только запросы с валидным телом; `400` квоту не расходует.
  - (a) Не более **5** поисков за **60 секунд** с одного IP (fixed window). Сверх лимита — `429`, `Retry-After: <секунды>`, тело `{ "error": { "code": "RATE_LIMITED", "message": "Слишком много запросов. Пожалуйста, повторите через минуту." } }`.
  - (b) Если с одного IP за **60 секунд** запрошено **5 разных** номеров, IP считается парсером и блокируется на **5 часов**: этот и все следующие поиски получают `429`, `Retry-After: <секунды>` (около 18000 при старте блокировки), тело `{ "error": { "code": "TRACKING_BLOCKED", "message": "Поиск заказов временно недоступен. Пожалуйста, попробуйте снова примерно через 5 часов." } }`. Повторы того же номера считаются в (a), но не в (b). Поиски, отклонённые лимитом (a), всё равно учитываются в (b).
  - Порядок: активная блокировка, затем учёт номера (может начать блокировку), затем лимит (a), затем вызов Lambda. При `429` Lambda не вызывается.
  - Номера хранятся только как HMAC-SHA-256 со случайным ключом процесса, не более 5 на IP, и удаляются через 60 секунд. Raw phone и hash в `console.*` не пишутся.
  - До **10 000** IP в каждой таблице. При заполнении таблицы блокировок вытесняется блокировка, истекающая раньше всех (fail open), вместо отказа всем новым клиентам.
  - **Ограничение (Option A, решение владельца — хранить в памяти сайта):** счётчики и блокировка хранятся в памяти каждого Vercel instance. Они теряются при cold start/redeploy и не общие между instances, поэтому 5-часовая блокировка **не гарантирована** — на практике она может длиться минуты; смена IP её обходит. Надёжная глобальная блокировка требует хранилища в Lambda/RDS (миграция, деплой Lambda, доверенная передача IP) или Vercel KV/Upstash — отдельная задача с согласованием владельца.
  - Per-phone bucket намеренно не реализован: иначе атакующий мог бы заблокировать жертве отслеживание собственных заказов. Hash телефона используется только для подсчёта разных номеров на IP, поэтому требование «по IP и hash телефона» выполнено частично.
  - Риск ложных срабатываний: общий IP (NAT мобильного оператора, семья) может попасть под (b). Сообщение нейтральное; пороги — именованные константы в `src/lib/tracking-guard.ts`.
- Response содержит `order_reference`, status, `medicine_id`, item names/quantities/selling snapshots, `items_subtotal`, `order_total` и timestamps. Delivery fee отсутствует.
- Точный адрес, полный телефон, base price, admin notes и чужие заказы исключены.

Phone-only tracking с rate limiting утверждён для MVP. OTP и связка `order_reference + phone` отложены на будущий milestone.

## 8. Admin contracts

Все admin endpoints требуют валидную admin session в Next.js, разрешённую server identity в API Gateway и повторную role/permission check в Lambda.

### 8.1 Orders

- `GET /v1/admin/orders?status=...&created_from=...&created_to=...&limit=20&cursor=...`
- Ordering: `created_at DESC, order_id DESC`.
- `GET /v1/admin/orders/{order_id}` возвращает order, item snapshots и append-only `status_history`.

`PATCH /v1/admin/orders/{order_id}/status` request:

```json
{
  "status": "confirmed",
  "expected_current_status": "pending",
  "reason": null
}
```

- Разрешённые transitions определены в `PRODUCT.md`.
- `expected_current_status` защищает от одновременного изменения.
- Order update и audit insert выполняются одной транзакцией.
- `409 ORDER_STATUS_CONFLICT` — текущий статус уже изменился.
- `422 INVALID_STATUS_TRANSITION` — переход запрещён.
- `reason` обязателен для `cancelled`, max 500 символов.
- `DELETE /v1/admin/orders/{order_id}` доступен только для `pending` и `cancelled`.
- Удаление заказа логическое: выставляются `deleted_at` и `deleted_by`; состав, цены и status history сохраняются.
- Повторное удаление возвращает `409 ORDER_ALREADY_DELETED`, запрещённый статус — `409 ORDER_DELETE_STATE_CONFLICT`.
- Успешная операция записывается в `admin_audit_log` вместе с actor и request ID.

### 8.1.1 Цены позиций и доставка

Оба вызова идут через тот же `PATCH /v1/admin/orders/{order_id}/status` (маршрут в API Gateway не добавляется); Lambda различает их по составу тела.

- Цены позиции: `{ "order_item_id": 12, "selling_unit_price": 30, "base_unit_price": 25 }`. Обязателен `order_item_id` и хотя бы одна из цен (0.01–10 000 000). `line_total` и итог заказа пересчитываются в Lambda, прежняя и новая цены пишутся в `admin_audit_log`.
- Доставка (админ): `{ "delivery_courier_amount": 12, "delivery_owner_amount": 8.5 }`, оба значения 0–1 000 000. `delivery_fee = delivery_courier_amount + delivery_owner_amount` вычисляется и не хранится отдельно. Сумма доставки не входит в `order_total`.
- Доставка (курьер): `PATCH /v1/staff/orders/{order_id}/status` с телом `{ "delivery_courier_amount": 20 }`. Курьер меняет только свою часть, не видит долю владельца и не может менять отменённый заказ (`409 ORDER_STATUS_CONFLICT`).
- `GET /v1/admin/orders*` возвращает `delivery_courier_amount`, `delivery_owner_amount`, `delivery_fee`; dashboard — `delivery_owner_total` и `delivery_courier_total` по доставленным заказам за период.
- Миграция: `db/migrations/0018_order_delivery_fee.sql` (аддитивная, существующие заказы получают 0/0).

### 8.1.2 Курьер: товары, данные клиента, заработок

- Каталог общий для аптек 1 и 2: `POST /v1/staff/orders` и `POST /v1/staff/orders/{order_id}/items` принимают каталожные позиции для любой аптеки.
- У каждой каталожной позиции есть необязательное поле `unit_price` (цена для клиента, 0.01–999 999.99, не больше двух знаков после запятой). Без него цена по умолчанию: базовая цена каталога для заказов сотрудников и цена с наценкой для заказов с сайта. При добавлении товара, который уже есть в заказе, `unit_price` обновляет цену этой строки. `base_unit_price` всегда берётся из каталога.
- **Свои заказы.** Курьер меняет содержимое только тех заказов, которые создал сам (`created_by_staff_account_id = 3`). Это данные клиента, добавление, правка и удаление товаров. Для заказов с сайта эти вызовы от курьера возвращают `403 FORBIDDEN`. Статус и свою плату за доставку курьер меняет во всех заказах. Администратор работает со всеми заказами, как раньше.
- `GET /v1/staff/orders` и `GET /v1/staff/orders/{order_id}` (курьер) возвращают по каждой позиции `order_item_id`, `selling_unit_price` и `line_total`, а по заказу — `order_total`, `website_order` и `own_order`.
- `PATCH /v1/staff/orders/{order_id}/customer` с телом `{ "customer_name": "Фарход", "phone": "917123456", "address": "...", "landmark": "..." }`. Работает в любом статусе: имя до 120 символов (можно пустое), адрес 3–500, ориентир 2–300. Увеличивает `edit_revision` и пишет `courier.order.customer_updated` в `admin_audit_log`.
- `PATCH /v1/staff/orders/{order_id}/items/{order_item_id}` с телом `{ "quantity": 2, "unit_price": "18.50" }` (одно или оба поля) меняет строку. `DELETE` на тот же адрес удаляет её. Итог заказа пересчитывается, в журнал пишется `courier.order.item_updated` или `courier.order.item_removed`. Отменённый заказ не меняется (`409`).
- **Чек-лист доставки (только заказы с сайта).** `GET /v1/staff/orders` и `GET /v1/staff/orders/{order_id}` возвращают `checklist_steps` — отсортированный массив отмеченных вручную шагов (`[]`, если нет). Чек-лист v2 — 7 шагов владельца. Шаги 1, 2, 3, 6 курьер отмечает сам; шаги 4, 5, 7 выводятся из статуса (4 — `confirmed`/`delivering`/`delivered`, кнопка «Согласовано» `pending → confirmed`; 5 — `delivering`/`delivered`, «Выехал» `confirmed → delivering`; 7 — `delivered`, «Доставлен» `delivering → delivered`) и через этот маршрут не сохраняются. Шаги внутренние для курьера: это не статусы заказа, `order_status_history` и страница `/tracking` не меняются.
  - `PATCH /v1/staff/orders/{order_id}/checklist` (только курьер, `session_account(courier=True)`) с телом `{ "step": 2, "done": true }`. `done: true` сохраняет шаг, `done: false` снимает; повтор того же запроса — успешный no-op. Ответ: `{ "order_id": "...", "checklist_steps": [1, 2] }`. Каждое реальное изменение пишет `courier.order.checklist_updated` в `admin_audit_log`.
  - Ошибки: лишние ключи, нецелый шаг, шаг вне 1–7 («Шаг должен быть числом от 1 до 7») или шаг 4/5/7 («Этот шаг отмечается сменой статуса заказа») → `400 VALIDATION_ERROR`; отменённый заказ → `409 ORDER_STATUS_CONFLICT`; заказ не с сайта → `409 CHECKLIST_NOT_AVAILABLE`; нет заказа или он удалён → `404 ORDER_NOT_FOUND`.
  - Хранение: таблица `order_courier_checklist (order_id, step, completed_at, completed_by)` из миграции `db/migrations/0023_order_courier_checklist.sql`. Миграцию нужно применить до деплоя Lambda, иначе список заказов курьера перестанет работать. Для чек-листа v2 новая миграция не нужна (кроме 0023): CHECK `step BETWEEN 1 AND 8` уже допускает 1–7.
  - Новые записи v2 хранят `completed_by = 'staff:3/v2'`. Любое другое значение `completed_by` — запись старого 8-шагового чек-листа (задача 001), она переводится при чтении в SQL (`_COURIER_ORDER_SELECT` и перечитывание после PATCH): старый 1 → новый 1, старый 4 → новый 2, старые 2, 5, 7 игнорируются (5 и 7 теперь выводятся из статуса). Данные не переписываются.
  - `done: true` — `INSERT ... ON CONFLICT (order_id, step) DO UPDATE SET completed_by = EXCLUDED.completed_by, completed_at = now() WHERE order_courier_checklist.completed_by <> EXCLUDED.completed_by`: старая запись с тем же номером переводится в v2, повтор v2 — no-op. `done: false` удаляет запись `step = N` с любой меткой; для шага 2 также удаляется старая запись `step = 4` (`completed_by <> 'staff:3/v2'`).
  - Next.js: `PATCH /api/staff/orders/{order_id}/checklist` проксирует запрос с серверной сессией сотрудника.
- `GET /v1/staff/order-medicines` также возвращает `selling_unit_price` (цена с наценкой).
- `GET /v1/staff/earnings`: в каждом дне `daily[]` есть `courier_orders_count` (создал курьер) и `website_orders_count` (заказы с сайта), помимо `orders_count` и `amount`.
- Все новые маршруты покрыты существующим `ANY /v1/staff/{proxy+}`, менять API Gateway не нужно.

### 8.1.2a Аптека: экран заказов на сборку

- `GET /v1/staff/orders` с сессией аптеки (аккаунты 1 и 2, `list_pharmacy_preparation_orders`) возвращает только заказы с сайта (`created_by_staff_account_id IS NULL`) в статусах `pending`/`confirmed`, где `COALESCE(fulfillment_pharmacy_id, 1)` равен `account_id` из проверенной Lambda сессии. Аптеку нельзя выбрать параметром запроса: любой ключ, кроме `limit` и `cursor` (например, `pharmacy_id`, `account_id`), даёт `400 VALIDATION_ERROR`. Позиции не делятся между аптеками: аптека видит все позиции назначенных ей заказов. Заказы с сайта идут в аптеку 1, поэтому очередь аптеки 2 пуста, пока ей не назначены заказы.
- Поля заказа фильтруются политикой `pharmacy_web` (настройки оповещений). По умолчанию включены `order_reference`, `created_at`, `comment` (`notes`), `items`, `quantity`, `status`, `item_base_total`, `base_total`. Имя клиента, телефон, адрес, ориентир, клиентская сумма (`order_total`), `line_total`, `profit` и создатель по умолчанию не возвращаются. Сохранённые владельцем настройки имеют приоритет над этими значениями по умолчанию.
- Цена для аптеки — базовая (цена аптеки), как в Telegram-оповещении аптеки: в `medicines[]` поля `base_unit_price = COALESCE(base_unit_price, price)` и `base_line_total = base_unit_price * quantity` (оба — десятичные строки из SQL), в заказе — `base_total` (сумма `base_line_total`). `item_base_total` управляет `base_unit_price` и `base_line_total`, `base_total` — итогом. Если они выключены, поля отсутствуют, и экран не показывает столбцы «Цена»/«Сумма» и строку «Итого». Экран не пересчитывает суммы в JS.
- Всегда (вне политики, без данных клиента) возвращаются `waiting_since` (ISO с часовым поясом, равно `created_at`) и `awaiting_response` (`true`, пока заказ в статусе `pending`; `false` после «Согласовано», `pending → confirmed`). Экран показывает «Ожидает обработки N мин» только при `awaiting_response: true`: до 10 мин нейтрально, 10–19 мин жёлтым, от 20 мин красным; счётчик обновляется раз в 30 с без перезагрузки. Задача «действия фармацевта» переопределит `awaiting_response` на сервере (до первого ответа фармацевта) без изменения экрана. Старая Lambda без этих полей: бейдж и цены не показываются.
- Экран `/staff/orders` аптеки следует политике `pharmacy_web`, которую уже применила Lambda: поле показывается, если оно есть в ответе (владелец включил его в настройках оповещений), и скрыто, если его нет. Так выводятся имя клиента, телефон (ссылка `tel:`), адрес, ориентир, источник, создатель («Сайт» / «Сотрудник N»), столбец «Клиенту» (`line_total`, только если он есть у всех позиций), клиентская сумма (`order_total`) и разница (`profit`). По умолчанию все эти поля выключены, поэтому аптека их не видит. Модель карточки — `pharmacyOrderView` в `src/lib/pharmacy-order.ts`.
- Изменения вступают в силу после деплоя `admin-api-v1.zip`; миграции не нужны.

### 8.1.3 Обзор заказов для администратора

- `GET /v1/admin/orders/insights?days=1|7|30|90` (по умолчанию 7, календарные дни Душанбе). Возвращает:
  - `live` — сколько заказов сейчас новых, собирается и в пути, и до 12 новых заказов;
  - `totals` — за период: заказано (шт. и сумма), доставлено (шт. и сумма), средний чек, прибыль (цена клиента − цена аптеки), отменено, часть доставки курьера и владельца, сколько доставок сделал владелец (`delivery_owner_amount > 0` и `delivery_courier_amount = 0`);
  - `daily` — по каждому дню периода, включая пустые: доставки сайта, курьера и аптек (шт. и суммы), прибыль и доли доставки;
  - `top_medicines` — 10 лекарств с наибольшей суммой;
  - `hours` — заказы по часам;
  - `clients` — новые и постоянные номера;
  - `delivered_orders` — до 200 доставленных заказов с прибылью и долями доставки.
- `GET /v1/admin/orders/delivered-day` дополнительно отдаёт в `summary` поля `total_sales`, `website_sales`, `courier_sales`, `pharmacy_sales`, `courier_fee`, `owner_fee`, `owner_delivered`.
- `GET /v1/admin/orders/insights/orders?days=1|7|30|90&metric=…&limit=1..100&cursor=…` — заказы (или клиенты), из которых состоит одна карточка обзора. Начало периода, фильтры и формулы `sales`/`base` — те же общие SQL-фрагменты, что в `orders/insights`, поэтому `summary` совпадает с карточкой.
  - `days` — по умолчанию 7; `metric` — обязателен; `limit` — по умолчанию 50, максимум 100. Любой другой параметр, неверный `days`/`metric`/`limit` или испорченный `cursor` — `400 VALIDATION_ERROR`. `metric` выбирает один из фиксированных SQL-фрагментов и никогда не подставляется в SQL.
  - `ordered` — не удалённые заказы, созданные за период, `status <> 'cancelled'`, по `created_at DESC, id DESC`. `summary`: `count` = `totals.ordered_count`, `sum` (по `order_total`) = `totals.ordered_sum`.
  - `cancelled` — то же, но `status = 'cancelled'`. `summary.count` = `totals.cancelled_count`.
  - `delivered` и `average_check` — доставленные заказы с датой доставки в периоде (`DELIVERED_DAY_CTE`), по `delivered_at DESC, id DESC`. `summary`: `count` = `totals.delivered_count`, `sum` (по `sales`) = `totals.delivered_sum`; средний чек = `sum / count`.
  - `profit` — те же доставленные заказы, по `profit ASC, id ASC` (сначала убыточные). `summary.profit` = `totals.profit`.
  - Строка заказа: `order_id` (`ord_…` или `legacy_N`), `order_reference`, `customer_name`, `status`, `created_at`, `delivered_at` (только для доставленных метрик), `created_by_staff_account_id`, `order_total`, `sales`, `base`, `profit` (= `sales − base`), `delivery_courier_amount`, `delivery_owner_amount`. `summary` заказных метрик: `count`, `sum`, `profit` по всем строкам, а не только по странице.
  - `clients` — по одной строке на `phone_normalized` с неотменённым заказом, созданным в периоде: `customer_name` и `phone` из последнего заказа, `orders_in_period`, `first_order_at`, `is_new` (`first_order_at >=` начала периода). Порядок `first_order_at DESC`, при равенстве — по внутреннему id первого заказа (телефон не попадает в `cursor`). `summary`: `new_clients`, `returning_clients` = `clients`.
  - Ответ: `{ metric, period_days, from, to, currency, summary, data, page: { next_cursor, has_more }, request_id }`. Пагинация keyset; `cursor` действителен только для той же `metric`.
- Только чтение. Новые маршруты покрыты `ANY /v1/admin/{proxy+}`.

### 8.2 Categories

- Create fields: `slug`, `name`, optional `icon`, `color`.
- `slug`: lowercase ASCII kebab-case, 2–80, unique и неизменяемый в MVP.
- Update allowlist: `name`, `icon`, `color`, `is_active`.
- `is_active=false` остаётся обычным способом скрыть категорию без удаления.
- `DELETE /v1/admin/categories/{category_id}` разрешён только при отсутствии связей с medicines и homepage banners.
- Категория в использовании возвращает `409 CATEGORY_IN_USE`; лекарства никогда не удаляются вместе с категорией.
- Успешное удаление категории и request ID записываются в `admin_audit_log`.
- Category/medicine relation использует `medicine_id` и требует существующую категорию и существующее лекарство.
- Admin list связей включает недоступные товары, чтобы связь можно было удалить после изменения наличия.
- Bulk preview требует `fragment` длиной 2–120 символов, ищет без учёта регистра и трактует `%`, `_` и `\` буквально. Ответ содержит `total`, numbered page и признак `already_present` для каждой строки.
- Bulk mutation принимает только `fragment` и `confirmed_count`. Если актуальный `matched` отличается от подтверждённого числа, запись не выполняется и возвращается `409 BULK_PREVIEW_STALE`.
- Bulk mutation использует один set-based `INSERT ... SELECT` в транзакции, не удаляет другие категории и возвращает `matched`, `added`, `already_present`.
- Повторные `PUT`/`DELETE` relation идемпотентны.

## 9. Internal catalog sync

`agent_sync.exe` не обращается к RDS. С отдельной machine identity он:

1. вызывает `POST /v1/internal/catalog-syncs` с `source_updated_at`, file metadata и SHA-256;
2. загружает большой snapshot по короткоживущему pre-signed S3 URL;
3. вызывает idempotent `POST /v1/internal/catalog-syncs/{sync_id}/commit`;
4. читает status через `GET /v1/internal/catalog-syncs/{sync_id}`.

Sync Lambda проверяет checksum/schema, применяет правило ведущего `*`, валидирует весь snapshot в staging и только затем атомарно публикует его. Upsert сохраняет существующие `medicine_id`; полный snapshot не пересоздаёт primary keys. Ошибка не оставляет частично обновлённый каталог. Final states: `succeeded` или `failed`; history содержит counts и безопасные причины ошибок.

Подтверждённая схема `OSTATKI.DBF`: `NAME`, `PRICE`, `COUNTRY`, `PROIZVOD`; стабильный SKU отсутствует. Fallback identity — SHA-256 от нормализованного `source_id + NAME + PROIZVOD + COUNTRY`. Повторы fallback identity объединяются по правилу `available first -> maximum base price -> first DBF row`; усреднение цены не допускается. Количество и номера объединённых строк записываются в безопасный sync audit. Дублированный непустой `source_sku`, если поле появится в будущем, отклоняет snapshot.

## 10. Error contract

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "fields": {
        "items[0].quantity": "must be an integer between 1 and 99"
      }
    }
  },
  "request_id": "req_01J..."
}
```

| HTTP | Использование |
|---|---|
| `400` | Malformed JSON, schema, неизвестные поля |
| `401` | Identity отсутствует/невалидна |
| `403` | Permission отсутствует |
| `404` | Ресурс не найден |
| `409` | State/idempotency/availability conflict |
| `422` | Нарушено бизнес-правило |
| `429` | Rate limit |
| `500` | Неожиданная ошибка без внутренних деталей |

Responses и logs не содержат stack trace, SQL, environment values, credentials или полный payload с PII.

## 11. Security и reliability requirements

- Public, admin и internal principals имеют разные permissions; unknown routes/actions — deny-by-default.
- Текущая локальная development-конфигурация и API key сохраняются на Phase 2. Ротация выполняется при финальном production deployment; до этого ключ не переносится в новые client-side paths или logs.
- Create order и tracking имеют отдельные per-IP/phone-hash rate limits (целевое требование). Текущее состояние:
  - **Create order — реализован только per-IP лимит в Next.js** (`src/app/api/checkout/route.ts`, `src/lib/rate-limit.ts`): fixed window, не более **5** попыток за **10 минут** на один client IP (первый адрес `x-forwarded-for`, затем `x-real-ip`, иначе общий bucket `unknown`), до **10 000** отслеживаемых IP. Квоту расходуют только запросы с `Idempotency-Key` и валидным телом; повтор с тем же `Idempotency-Key` тоже считается попыткой. Лимит 5 покрывает один заказ, два повтора и одно исправление (например, после `ORDER_ITEMS_UNAVAILABLE`).
  - Сверх лимита ответ `429` с заголовком `Retry-After: <секунды>` и телом `{ "error": { "code": "RATE_LIMITED", "message": "Слишком много попыток оформить заказ. Подождите несколько минут и попробуйте снова." } }`; Lambda и Telegram-уведомления не вызываются. Корзина, данные формы и pending idempotency key в браузере сохраняются.
  - Счётчик хранится в памяти каждого Vercel instance: лимит не глобальный (фактический потолок — лимит × число тёплых instances), сбрасывается при cold start; это сдерживание флуда с одного IP, а не жёсткая гарантия.
  - **Не реализовано:** Lambda/RDS-side лимит для create order и лимит по hash телефона. Требует миграции и деплоя Lambda (или Vercel KV/Upstash) — отдельная задача.
  - Tracking (`/api/tracking`) имеет собственный per-IP guard в памяти Next.js: не более 5 поисков в минуту (`RATE_LIMITED`) и блокировка на 5 часов при 5 разных номерах за минуту (`TRACKING_BLOCKED`); оба ответа — `429` с `Retry-After`. Подробности и ограничения (per-instance, блокировка не гарантирована) — в §7. Lambda/RDS-side лимит для tracking не реализован.
- Next.js задаёт upstream timeout и отмену. Автоматические retries разрешены только для safe reads; order retry — только с тем же idempotency key.
- Admin reads/mutations используют `no-store`; search/get/categories могут иметь короткий TTL с invalidation после sync.
- Lambda использует parameterized SQL, transactions и DB constraints для prices, quantities, statuses, idempotency и `medicine_id` references.
- Audit logs содержат request ID, route, status, latency и безопасный resource ID, но не secrets, полный телефон/адрес или pre-signed URL.
- API Gateway access logs, Lambda metrics/errors/throttles и RDS health имеют alarms до production release.

## 12. Destructive actions и migration

`wipe_db`, `delete_all_orders` и `cleanup_archive` полностью исключены из API v1: routes отсутствуют, action mappings удаляются из v1 Lambda, а public/admin/internal principals не имеют соответствующих permissions. Любая аварийная операция с данными возможна только вне API v1 по отдельному runbook с backup, dry-run, MFA, двухсторонним подтверждением и audit trail.

Migration order:

1. Сохранить работающую локальную development-конфигурацию, не расширяя область видимости текущего ключа.
2. Создать отдельные `/v1/public`, `/v1/admin`, `/v1/internal` routes и authorizers.
3. Реализовать `medicine_id`, server-owned pricing и транзакционный `POST /v1/public/orders` без delivery fee.
4. Реализовать узкий phone-only tracking endpoint с rate limiting.
5. Перевести Next.js server calls на v1 и проверить access logs.
6. Отключить `/api/query` и полностью удалить destructive actions из v1 handler.
7. На финальном production deployment выпустить новый API key, переключить server-side environment и отозвать development/старый key.

## 13. Утверждённый baseline и release gates

Для Phase 2 утверждены:

1. Все catalog/order references используют `medicine_id`; название остаётся display snapshot.
2. Phone-only tracking с rate limiting используется в MVP; OTP отложен.
3. Цена единицы — `ceil(base × 1.05)`, minimum subtotal — 50 TJS.
4. Delivery fee не является частью заказа, не рассчитывается и не сохраняется аптекой; покупатель платит её напрямую курьеру.
5. Destructive actions полностью отсутствуют в API v1.
6. Development key остаётся активным на Phase 2; ротация выполняется на финальном production deployment.

Для production должны быть утверждены PII retention и окончательная admin/service authentication scheme; рекомендуются короткоживущая identity и API Gateway authorizer/IAM, не общий static key.

Перед release contract tests обязаны доказать: запрет клиентских цен/totals/statuses; корректную decimal-наценку; lookup по `medicine_id`; unavailable/minimum/idempotency cases; все status transitions; exact phone match; отсутствие delivery fee в order total; отсутствие доступа public principal к admin/internal routes; отсутствие production routes для wipe и массового удаления.

## Marketing collections and attribution

Public (API key only):

- `GET /v1/public/collections/{slug}` — active collection with live prices/stock in configured
  order; `404 COLLECTION_NOT_FOUND` for unknown or disabled slugs.
- `POST /v1/public/collection-events` — `collection_slug`, `event_type` (`view` | `product_open` |
  `add_to_cart`), `product_id` (required except for `view`, must belong to the collection),
  `visitor_id`, `referrer`, `utm_*`, `user_agent`. Bot/preview user agents are dropped
  (`{recorded:false}`). Next.js `/api/collections/events` forwards browser events only.
- `POST /v1/public/orders` additionally accepts an optional `attribution`
  (`source_collection`, `utm_source|medium|campaign|content`). It is added by the Next.js
  `/api/checkout` route from the first-touch `vatan_src` cookie (7 days); the browser body may not
  set it. It is not part of the idempotency hash.

Admin (bearer): `GET/POST /v1/admin/collections`, `PATCH/DELETE /v1/admin/collections/{id}`,
`POST /v1/admin/collections/resolve-products`, `GET /v1/admin/collection-stats?from&to&slug`.
Saving validates that every product ID exists (`422 PRODUCTS_NOT_FOUND`). Order list/detail include
the attribution fields. Cookies: `vatan_vid` (random visitor id, 30 days), `vatan_src` (7 days).

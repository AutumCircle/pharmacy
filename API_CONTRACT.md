# Pharmacy Vatan V4 — API Contract v1

**Status:** Approved specification v1.0; implementation pending Phase 2
**Scope:** Next.js → API Gateway → Python Lambda → RDS PostgreSQL
**Base path:** `/v1`

Homepage content routes:

- `GET /v1/public/homepage-banners` — active homepage banner metadata.
- `GET /v1/admin/homepage-banners` — all four banner slots (admin authorization required).
- `PATCH /v1/admin/homepage-banners/{slot}` — update title, subtitle, HTTPS image URL, link, or active state.
- `GET /v1/public/product-carousels` — active carousel sections in configured order with their available products.
- `GET /api/product-carousels` (Next.js, public, no auth) — whitelisted JSON copy of the homepage carousels for the iOS app; see §5.4.
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

### 4.4 Internal pharmacy mirror

| Method и route | Назначение |
|---|---|
| `POST /v1/internal/pharmacy-mirror/batches` | Принять пакет изменённых строк и удалённых ключей одной таблицы Oracle |
| `POST /v1/internal/pharmacy-mirror/heartbeat` | Отметка агента аптеки «на связи» и краткий статус |
| `GET /v1/internal/pharmacy-mirror/status` | Число строк и максимальный `CHANGE_ID` по таблицам этой аптеки |

Авторизация — bearer-токен конкретной аптеки из `PHARMACY_AGENT_TOKEN_<id>` (не меньше 32 символов). Токен определяет `pharmacy_id`; токен `agent_sync` здесь не принимается, а токен аптеки не принимается маршрутами `catalog-syncs`. Подробности — раздел 9.1.

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

### 5.4 Public product carousels JSON for iOS (`GET /api/product-carousels`)

`GET https://www.aptekavatan.tj/api/product-carousels` — Next.js route handler
(`src/app/api/product-carousels/route.ts`) для iOS-приложения и других публичных клиентов. Он
отдаёт те же активные карусели, что и главная страница сайта.

- **Без авторизации:** обычный HTTPS GET (URLSession). API-ключ, логин Vercel и доступ к AWS не нужны.
  Сервер Next.js вызывает `getPublicProductCarousels()` → `GET /v1/public/product-carousels` в
  API Gateway с серверным `API_KEY`. Ключ в ответ и в клиент не попадает. Путь данных не меняется:
  Next.js → API Gateway → Python Lambda → RDS.
- **Порядок:** как в Lambda (карусели по `sort_order, id`, товары по `sort_order, id`). Route
  ничего не пересортировывает.
- **Whitelist:** ответ строится через `toPublicCarouselsPayload` (`src/lib/public-carousels.ts`).
  `country`, `vendor`, `catalog_updated_at`, `request_id`, базовая цена, прибыль, `is_active`,
  внутренние ID и любые новые поля upstream не передаются.
- **Пустые карусели:** карусели без товаров опускаются (как на главной). Если не осталось ни одной
  карусели, ответ `200 {"carousels": []}`: массив, никогда не `null`.

Поля успешного ответа `200`:

| Поле | Тип | Описание |
|---|---|---|
| `carousels` | array | Активные карусели в порядке показа |
| `carousels[].slug` | string | Идентификатор секции |
| `carousels[].title` | string | Заголовок секции |
| `carousels[].sort_order` | integer | Порядок секции |
| `carousels[].products` | array | Товары секции, не пустой |
| `products[].medicine_id` | integer | ID товара (как в `/medicine/...` и в заказе) |
| `products[].medicine_name` | string | Название |
| `products[].selling_unit_price` | integer (JSON number) | Цена продажи в TJS, как на сайте |
| `products[].currency` | string | Всегда `"TJS"` |
| `products[].in_stock` | boolean | Есть ли в наличии |
| `products[].image_url` | string \| null | URL изображения или `null` |
| `products[].sort_order` | integer | Порядок товара в секции |

Сейчас `selling_unit_price` — целое число (Lambda приводит его через `int()`). Если контракт
Lambda когда-нибудь перейдёт на дробные цены, iOS должен декодировать поле как `Decimal`/`Double`.
Поэтому лучше сразу декодировать его как число без привязки к `Int`.

```json
{
  "carousels": [
    {
      "slug": "items-of-the-day",
      "title": "Товары дня",
      "sort_order": 10,
      "products": [
        {
          "medicine_id": 1234,
          "medicine_name": "Парацетамол 500 мг №10",
          "selling_unit_price": 12,
          "currency": "TJS",
          "in_stock": true,
          "image_url": "https://example.com/paracetamol.jpg",
          "sort_order": 10
        }
      ]
    }
  ]
}
```

Ошибка: любая ошибка upstream (ошибка конфигурации, timeout, недоступный или некорректный ответ
API Gateway/Lambda, неожиданное исключение) → `503`, `Cache-Control: no-store`, `Retry-After: 30`:

```json
{ "error": { "code": "CAROUSELS_UNAVAILABLE", "message": "Секции товаров временно недоступны." } }
```

Upstream-коды, сообщения, details, stack traces и значения env не передаются. Клиент должен
ориентироваться на HTTP status и `error.code`, а не на текст `message`.

Кеширование: как на главной странице. Upstream fetch использует data cache Next.js с
`revalidate: 60`. Успешный ответ отдаётся с
`Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (CDN Vercel). Route
`force-dynamic`, поэтому на этапе build он не пререндерится.

CORS-заголовков нет: нативному URLSession они не нужны. Отдельного rate limiting тоже нет:
нагрузку на Lambda ограничивают CDN-кеш на 60 с и 60-секундный data cache.

### 5.5 Public homepage banners JSON for iOS (`GET /api/homepage-banners`)

`GET https://www.aptekavatan.tj/api/homepage-banners` — anonymous HTTPS GET. No Vercel
login, AWS access or API key is needed in the iOS app. Next.js calls the same
`getPublicHomepageBanners()` server helper as the homepage; only that server helper
sends the API Gateway key. The route is read-only and does not access RDS directly.

Success (`200`) has a root `banners` array, never `data.banners`:

```json
{
  "banners": [{
    "slot": "mobile",
    "title": null,
    "subtitle": null,
    "image_url": "https://example.com/banner.png",
    "link_url": "/catalog",
    "cta_text": null,
    "alt_text": "Аптека Ватан",
    "fit_mode": "contain",
    "mobile_override": false
  }]
}
```

This sample shows the principal fields only. Each actual banner additionally has
the public presentation fields for image sizing/position, overlay, text layout,
normalized element coordinates and optional mobile composition, as defined by
`HomepageBanner` in `src/lib/api-v1/types.ts`. The explicit whitelist is in
`src/lib/public-banners.ts`; unknown upstream fields, internal metadata and
`request_id` are dropped. Banner order follows the homepage response and `slot`
identifies placement: `left`, `center`, `right_top`, `right_bottom`, `mobile`.
For a phone layout, use the `mobile` slot as the website does. An image-only banner
has null text and should not create empty text or CTA elements. `image_url` can be
null on a text-only banner. `link_url` may be a site-relative path; resolve it
against `https://www.aptekavatan.tj` before opening. Empty or inactive banners
are omitted; no banners means `200 {"banners": []}`.

Success is cached for 60 seconds at both the upstream fetch and CDN. On upstream
failure the route returns `503`, `Cache-Control: no-store`, `Retry-After: 30`:

```json
{ "error": { "code": "BANNERS_UNAVAILABLE", "message": "Баннеры временно недоступны." } }
```

Native URLSession does not need CORS headers. Treat `503` as an error with a retry,
not as an empty banner list.

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
  "landmark": "напротив школы № 20",
  "payment_method": "e_wallet",
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
- `landmark`: optional, max 300 символов, пустая строка → `null`. Сохраняется в `orders.landmark` (колонка из
  миграции `0015`). До редизайна оформления сайт склеивал его в `address` как «Адрес (Ориентир)»; такие старые
  заказы в БД не меняются, экраны админа, курьера и аптеки показывают их раздельно (`splitLegacyAddress` в
  `src/lib/checkout-order.ts`, только отображение).
- `payment_method`: optional, `cash_on_delivery` (по умолчанию) или `e_wallet`. Это только выбор клиента, который
  видят админ, курьер и Telegram (владелец и курьер, не аптека); онлайн-оплаты нет, `payment_status` всегда `unpaid`.
- `comment`: optional, max 500 символов.
- `items`: 1–50 уникальных позиций.
- `medicine_id`: положительный integer, существующий в каталоге.
- `quantity`: integer, 1–99.
- Повторяющиеся `medicine_id` отклоняются с `DUPLICATE_ORDER_ITEM`.

Обязательный алгоритм Lambda:

1. Проверить caller, rate limit, schema и `Idempotency-Key`.
   - Текущая реализация: per-IP лимит попыток создания заказа применяется в Next.js route `POST /api/checkout` (см. §11), до вызова Lambda. Lambda-side лимит и лимит по hash телефона для create order пока не реализованы.
2. Повтор с тем же key и payload возвращает исходный response; тот же key с другим payload — `409 IDEMPOTENCY_CONFLICT`.
   - Защита от двойного заказа с новым key (вторая вкладка, повторное нажатие после перезагрузки): под
     `pg_advisory_xact_lock` по телефону Lambda ищет заказ с сайта со статусом `pending`, тем же телефоном, тем же
     `address` и ровно тем же набором `(medicine_id, quantity)`, созданный за последние 10 минут
     (`DUPLICATE_ORDER_WINDOW_MINUTES`). Если он есть, новый заказ не создаётся: ответ `200` с этим заказом и
     `"deduplicated": true`, Telegram не отправляется, ответ сохраняется в `order_idempotency` под новым key.
3. В одной DB transaction получить все позиции по primary key `medicine_id`.
4. Для каждой позиции потребовать ровно одну активную запись с `in_stock=true` и положительной `base_unit_price`.
5. Decimal arithmetic: `selling_unit_price = ceil(base_unit_price × 1.05)`.
6. Рассчитать `items_subtotal = Σ(selling_unit_price × quantity)` и проверить `items_subtotal >= 50`.
7. Установить server-owned значения: `order_total=items_subtotal`, `payment_method` из запроса (по умолчанию `cash_on_delivery`), `payment_status=unpaid`, `status=pending`. `delivery_fee` и `grand_total` не рассчитываются и не сохраняются.
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
- Response содержит `order_reference`, status, `payment_method`, `medicine_id`, item names/quantities/selling snapshots, `image_url` позиции (фото из каталога через `LEFT JOIN medicines`, `null` для удалённых), `items_subtotal`, `order_total` и timestamps. Delivery fee отсутствует.
- Точный адрес, полный телефон, base price, admin notes и чужие заказы исключены.
- **`stage` (задача 013).** Каждый заказ ответа содержит `stage` рядом с неизменным `status`: `assembling`
  («Собирается»), `assembled` («Собран»), `confirmed` («Подтверждён»), `delivering` («В пути»), `delivered`
  («Доставлен»), `cancelled`. Вычисляется в Lambda общим правилом `backend/v1/shared/order_stage.py`
  (коррелированное SQL-выражение в том же `SELECT` заказов — запросов всегда два, без N+1, без записей):
  `pending` даёт `assembled` только для заказа с сайта, у которого есть хотя бы одна аптека сборки (различные
  текущие аптеки позиций, чья текущая аптека не ответила `unavailable`) и каждая из них отметила
  `order_pharmacy_assembly.state = 'assembled'`; иначе `assembling`. Остальные статусы — 1:1. `create_order`
  возвращает `stage: "assembling"`. Запрос по-прежнему принимает только `{phone}`; клиент stage не передаёт.
  Без нового Lambda `/tracking` берёт этап из `status` (`pending` → «Собирается», «Собран» не появляется).

Phone-only tracking с rate limiting утверждён для MVP. OTP и связка `order_reference + phone` отложены на будущий milestone.

## 8. Admin contracts

Все admin endpoints требуют валидную admin session в Next.js, разрешённую server identity в API Gateway и повторную role/permission check в Lambda.

### 8.1 Orders

- `GET /v1/admin/orders?status=...&created_from=...&created_to=...&limit=20&cursor=...`
- Ordering: `created_at DESC, order_id DESC`.
- `GET /v1/admin/orders/{order_id}` возвращает order, item snapshots и append-only `status_history`.
- **Задача 013.** `GET /v1/admin/orders` и `GET /v1/admin/orders/{order_id}` дополнительно возвращают `stage`
  (то же правило, что в §7). Деталь заказа также возвращает `fulfillment` — только для чтения, одним
  дополнительным запросом (проекция курьера `_COURIER_ORDER_SELECT`), `null` для заказов, созданных
  сотрудниками: `{stage, checklist_steps, assembly, assembly_complete, pharmacy_answers_complete,
  confirmed_total, unavailable_count, answered_count, item_count, items: [{order_item_id, medicine_name,
  pharmacy_id, answers}]}`. Данных клиента в блоке нет. Карточка `/admin/orders/[id]` показывает 7 шагов
  чек-листа курьера, «Ватан N: собран / собирается / ждёт сборки», аптеку и ответ по каждой позиции и
  «Подтверждённая сумма» / «Сумма ещё не подтверждена аптекой»; кнопок нет. Без поля (старый Lambda) блок скрыт.
- **История заказа (задача 016).** `GET /v1/admin/orders/{order_id}` дополнительно возвращает `timeline` —
  хронологию заказа (старые → новые, не больше 200 последних событий) и `timeline_truncated` (`true`, если событий
  больше). Новой таблицы и миграции нет: события собираются из `orders.created_at`, `order_status_history`
  и `admin_audit_log` (`resource_type='order'` по публичному id заказа или `legacy_N`; `resource_type='order_item'`
  по текущим позициям; удалённые позиции — по `details.order_id` / `details.order_reference` / `details.reference`
  только среди строк `order_item` с `created_at >= orders.created_at`). Два дополнительных параметризованных
  запроса с `LIMIT 201`, сортировка по времени, затем id. Модуль `backend/v1/shared/order_timeline.py` отдаёт
  только ключи из белого списка, сырой `details` в ответ не попадает:
  `{at, kind, actor, pharmacy_id?, order_item_id?, medicine_name?, from_status?, to_status?, answer?,
  previous_price?, new_price?, client_price?, step?, done?, reason?, state?, count?, fields?}`, где
  `actor` — `customer | admin | courier | pharmacy | system` (`staff:1/2` → аптека с `pharmacy_id`, `staff:3` →
  курьер, имена администраторов не передаются), `fields` — `[{field, previous, current}]` (данные клиента, количество,
  цены позиции, доставка). `kind`: `created`, `status_changed`, `pharmacy_answer`, `pharmacy_routed`,
  `pharmacy_price_changed`, `item_collected`, `assembly_marked`, `assembly_reopened`, `checklist_updated`,
  `customer_updated`, `item_updated`, `item_removed`, `items_added`, `delivery_fee_updated`, `deleted`; неизвестное
  действие аудита → `other` без деталей («Изменение заказа»). Строка истории `NULL → статус` и аудит
  `staff.order.created` сливаются с событием `created`; аудит `courier.order.status_changed` не дублирует строку
  `order_status_history` той же транзакции. Русский текст строит Next.js (`src/lib/order-timeline.ts`).
  Карточка `/admin/orders/[id]`: справа сначала «Клиент», затем «Курьер и аптеки» (чек-лист и сборка), статус,
  доставка, удаление; слева таблица товаров (аптека, «передано из Ватан 1», количество, цена клиенту, сумма,
  ответ аптеки, последнее изменение из истории), под ней «Сумма заказа» и «Подтверждено аптеками», затем «История».
  Без `timeline` (старый Lambda) «История» показывает `status_history`.

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
- **Фильтры списка курьера.** `GET /v1/staff/orders?date=2026-10-21&status=undelivered&limit=20&cursor=…`:
  - `status` — `pending`, `confirmed`, `delivering`, `delivered`, `cancelled` или `undelivered` (= `pending`/`confirmed`/`delivering`). Без `status` отменённые не показываются, как раньше. Другое значение → `400 VALIDATION_ERROR`.
  - `date` — `YYYY-MM-DD`, календарный день Asia/Dushanbe по `created_at` заказа (годы 2020–2100), иначе `400 VALIDATION_ERROR`. С `date` ответ дополнительно содержит `date`, `time_zone: "Asia/Dushanbe"` и `summary: { total, delivered, undelivered, cancelled }` за весь день независимо от `status` и страницы (`total` — без отменённых).
- **График курьера.** `GET /v1/staff/orders/daily?days=30` (только курьер, иначе `403`; `days` — `30` или `70`, по умолчанию `30`, иначе `400 VALIDATION_ERROR`). Ответ: `{ "data": [{ "date": "2026-09-22", "total": 1, "delivered": 1, "undelivered": 0, "cancelled": 0 }, …], "days": 30, "today": "2026-10-21", "time_zone": "Asia/Dushanbe" }` — каждый день периода (с нулями), от старого к сегодняшнему; день — Asia/Dushanbe по `created_at`.
- `PATCH /v1/staff/orders/{order_id}/customer` с телом `{ "customer_name": "Фарход", "phone": "917123456", "address": "...", "landmark": "..." }`. Работает в любом статусе: имя до 120 символов (можно пустое), адрес 3–500, ориентир 2–300. Увеличивает `edit_revision` и пишет `courier.order.customer_updated` в `admin_audit_log`.
- `PATCH /v1/staff/orders/{order_id}/items/{order_item_id}` с телом `{ "quantity": 2, "unit_price": "18.50" }` (одно или оба поля) меняет строку. `DELETE` на тот же адрес удаляет её. Итог заказа пересчитывается, в журнал пишется `courier.order.item_updated` или `courier.order.item_removed`. Отменённый заказ не меняется (`409`).
- **Чек-лист доставки (только заказы с сайта).** `GET /v1/staff/orders` и `GET /v1/staff/orders/{order_id}` возвращают `checklist_steps` — отсортированный массив отмеченных вручную шагов (`[]`, если нет). Чек-лист v2 — 7 шагов владельца. Шаги 1, 2, 6 курьер отмечает сам (задача 010: `COURIER_CHECKLIST_MANUAL_STEPS = {1, 2, 6}`); шаг 3 «Получить подтверждение наличия и цены» выводится из ответов аптек: выполнен, когда `pharmacy_answers_complete = true` или статус `confirmed`/`delivering`/`delivered`. Сохранённые ранее записи шага 3 остаются в таблице и игнорируются при чтении. Шаги 4, 5, 7 выводятся из статуса (4 — `confirmed`/`delivering`/`delivered`, кнопка «Согласовано» `pending → confirmed`; 5 — `delivering`/`delivered`, «Выехал» `confirmed → delivering`; 7 — `delivered`, «Доставлен» `delivering → delivered`) и через этот маршрут не сохраняются. Шаги внутренние для курьера: это не статусы заказа, `order_status_history` и страница `/tracking` не меняются.
  - `PATCH /v1/staff/orders/{order_id}/checklist` (только курьер, `session_account(courier=True)`) с телом `{ "step": 2, "done": true }`. `done: true` сохраняет шаг, `done: false` снимает; повтор того же запроса — успешный no-op. Ответ: `{ "order_id": "...", "checklist_steps": [1, 2] }`. Каждое реальное изменение пишет `courier.order.checklist_updated` в `admin_audit_log`.
  - Ошибки: лишние ключи, нецелый шаг, шаг вне 1–7 («Шаг должен быть числом от 1 до 7»), шаг 3 («Этот шаг отмечается ответом аптеки») или шаг 4/5/7 («Этот шаг отмечается сменой статуса заказа») → `400 VALIDATION_ERROR`; отменённый заказ → `409 ORDER_STATUS_CONFLICT`; заказ не с сайта → `409 CHECKLIST_NOT_AVAILABLE`; нет заказа или он удалён → `404 ORDER_NOT_FOUND`.
  - Хранение: таблица `order_courier_checklist (order_id, step, completed_at, completed_by)` из миграции `db/migrations/0023_order_courier_checklist.sql`. Миграцию нужно применить до деплоя Lambda, иначе список заказов курьера перестанет работать. Для чек-листа v2 новая миграция не нужна (кроме 0023): CHECK `step BETWEEN 1 AND 8` уже допускает 1–7.
  - Новые записи v2 хранят `completed_by = 'staff:3/v2'`. Любое другое значение `completed_by` — запись старого 8-шагового чек-листа (задача 001), она переводится при чтении в SQL (`_COURIER_ORDER_SELECT` и перечитывание после PATCH): старый 1 → новый 1, старый 4 → новый 2, старые 2, 5, 7 игнорируются (5 и 7 теперь выводятся из статуса). Данные не переписываются.
  - `done: true` — `INSERT ... ON CONFLICT (order_id, step) DO UPDATE SET completed_by = EXCLUDED.completed_by, completed_at = now() WHERE order_courier_checklist.completed_by <> EXCLUDED.completed_by`: старая запись с тем же номером переводится в v2, повтор v2 — no-op. `done: false` удаляет запись `step = N` с любой меткой; для шага 2 также удаляется старая запись `step = 4` (`completed_by <> 'staff:3/v2'`).
  - Next.js: `PATCH /api/staff/orders/{order_id}/checklist` проксирует запрос с серверной сессией сотрудника.
- **Ответы аптек для курьера (задача 010).** `GET /v1/staff/orders` и `GET /v1/staff/orders/{order_id}` дополнительно возвращают:
  - в каждой позиции `medicines[]`: `pharmacy_id` — текущая аптека позиции (`COALESCE(oi.fulfillment_pharmacy_id, аптека заказа)`), и `answers` — ответы всех аптек `[{pharmacy_id, answer, problem, answered_at}]` (`[]`, если ответов нет);
  - в заказе: `pharmacy_answers_complete` (у каждой позиции есть ответ её текущей аптеки), `confirmed_total` (десятичная строка: SQL-сумма `line_total` позиций с текущим ответом `available`; `null`, пока ответы неполные или есть `price_differs`), `unavailable_count` (позиции с текущим ответом `unavailable` — их нет ни в одной аптеке, в сумму не входят), `answered_count` и `item_count` (для строки «Ответ аптек: N из M»). Всё считается в одном SQL через LATERAL, без N+1; цены от клиента не принимаются.
  - Экран курьера показывает по позиции аптеку и ответ («Ватан 1: в наличии», «Ватан 1: нет → Ватан 2 · ждём ответ Ватан 2», «… нет ни в одной аптеке»), «Подтверждённая сумма: X сом» или «Сумма ещё не подтверждена аптекой»; рядом с шагом 4 — предупреждение, если сумма не подтверждена. «Согласовано» в Lambda не блокируется.
- **Отметки сборки для курьера (задача 011, доработка 1).** `GET /v1/staff/orders` и `GET /v1/staff/orders/{order_id}` дополнительно возвращают:
  - `assembly` — по одной записи на каждую аптеку сборки, по возрастанию `pharmacy_id`: `[{pharmacy_id, state, started_at, assembled_at}]`, где `state` — `waiting` (отметки нет, «Ждёт сборки»), `assembling` («Собирается») или `assembled` («Собран»). Аптеки сборки — различные текущие аптеки позиций (`COALESCE(oi.fulfillment_pharmacy_id, аптека заказа)`), у которых текущая аптека не ответила `unavailable` (позиции без ответа считаются). Аптека, у которой все позиции «Нет в наличии», в список не попадает. Для заказов, созданных сотрудником, — `[]`. Считается одним LATERAL в `_COURIER_ORDER_SELECT`, без N+1.
  - `assembly_complete` — `true`, если заказ не отменён и каждая аптека из `assembly` отметила `assembled` (если аптек сборки нет — `true`). Со статусом не связано: сборка идёт, пока заказ «Новый». Пример: заказ 1 → 2, «Ватан 1» собран, у «Ватан 2» отметки нет → `[{pharmacy_id: 1, state: "assembled"}, {pharmacy_id: 2, state: "waiting"}]`, `assembly_complete: false`.
  - **«Согласовано» ждёт сборку (доработка 1).** `PATCH /v1/staff/orders/{id}/status` курьера с `pending → confirmed` для заказа с сайта возвращает `409 ASSEMBLY_NOT_COMPLETE` «Сначала все аптеки должны отметить «Сборка сделана»», пока хотя бы одна аптека сборки не в `assembled` (проверка под `FOR UPDATE` строки заказа, то же правило, что и `assembly`). Заказы, где собирать нечего (все позиции «Нет в наличии»), и заказы курьера не блокируются. Смена статуса администратором не проверяет отметки. Остальные переходы не меняются.
  - Экран курьера: блок «Сборка в аптеках» со строками «Ватан 1: собран», «Ватан 2: собирается», «Ватан 2: ждёт сборки»; в списке для заказов `pending` и `confirmed` — короткая строка «Сборка: …». Пока заказ `pending` и `assembly_complete = false`, кнопки «Согласовано» (шаг 4) и «Принять заказ» неактивны, рядом показывается та же причина. Для заказов, уже `confirmed` без полной сборки (до доработки или подтверждённых администратором), у шага 5 и «Выехал» остаётся предупреждение «Не все аптеки отметили «Собран»» — «Выехал» не блокируется. Старая Lambda без `assembly`: ни отметок, ни блокировки.
  - **Цвета позиций (доработка 1):** позиция, переданная в «Ватан 2» и есть там, — оранжевая «В аптеке 2»; позиции нет ни в «Ватан 1», ни в «Ватан 2» — красная «Нет в наличии в обеих аптеках» (строка товара и метка; токены `--c-orange`/`--c-orange-soft` и `--c-brand`/`--c-brand-soft` в `staff.css`).
- **Этап заказа (задача 013).** `GET /v1/staff/orders` и `GET /v1/staff/orders/{order_id}` курьера возвращают
  `stage` (правило §7, считается из уже выбранных `assembly`). Курьер видит те же пять этапов, что клиент и
  администратор; кнопка `pending → confirmed` называется «Согласовано», шаг 4 чек-листа — «Статус станет «Подтверждён»».
- **Короткая история для курьера (задача 016).** Только `GET /v1/staff/orders/{order_id}` (курьер) дополнительно
  возвращает `timeline` и `timeline_truncated` (тот же формат событий, два запроса с `LIMIT 201`: строки
  `order_status_history` и аудит заказа только с действиями `pharmacy.order.items_answered`,
  `pharmacy.order.item_price_changed`, `pharmacy.order.item_collected`, `pharmacy.order.assembly_marked`,
  `pharmacy.order.assembly_reopened`, `courier.order.checklist_updated`). `courier_view` оставляет только
  `created`, `status_changed` (причина — только у отмены), ответы аптек и передачу в «Ватан 2», изменение цены
  аптекой, отметки сборки и шаги чек-листа; без `fields`, значений данных клиента, доли владельца, цен из правок
  администратора, удаления и имён администраторов (`actor: "admin"`). `GET /v1/staff/orders` (список) и маршруты
  аптек не меняются; аптеки историю не получают. Экран курьера: шапка → «Клиент» (телефон-ссылка, кнопка
  «Позвонить» ≥ 44 px) → товары по группам «Забрать в Ватан 1» / «Забрать в Ватан 2» / «Нет в наличии» с
  отметкой сборки и подтверждённой суммой → чек-лист → «Мне за доставку» → «История» (`<details>`, свёрнута) →
  закреплённая панель действий.
- `GET /v1/staff/order-medicines` также возвращает `selling_unit_price` (цена с наценкой).
- `GET /v1/staff/earnings`: в каждом дне `daily[]` есть `courier_orders_count` (создал курьер) и `website_orders_count` (заказы с сайта), помимо `orders_count` и `amount`.
- Все новые маршруты покрыты существующим `ANY /v1/staff/{proxy+}`, менять API Gateway не нужно.

### 8.1.2a Аптека: экран заказов на сборку

- `GET /v1/staff/orders` с сессией аптеки (аккаунты 1 и 2, `list_pharmacy_preparation_orders`) возвращает только заказы с сайта (`created_by_staff_account_id IS NULL`) в статусах `pending`/`confirmed`, где хотя бы одна позиция назначена аптеке из проверенной Lambda сессии. Назначение позиции (задача 010): `COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)`. Аптека видит **только свои позиции**, `base_total` считается по ним. Аптеку нельзя выбрать параметром запроса: любой ключ, кроме `limit` и `cursor` (например, `pharmacy_id`, `account_id`), даёт `400 VALIDATION_ERROR`. Существующие позиции с `NULL` ведут себя как раньше (весь заказ у аптеки заказа).
- Вне политики `pharmacy_web` (без данных клиента) в каждой позиции возвращаются `order_item_id`, `my_answer` (`available`/`unavailable`/`price_differs`/`null`) и `my_problem`, в заказе — `routed_away_count` (позиции, которые эта аптека ответила «Нет в наличии» и которые теперь у другой аптеки; карточка показывает «Передано в Ватан 2: N поз.»). Если политика скрывает состав (`items`), позиций и кнопок ответа нет.
- Поля заказа фильтруются политикой `pharmacy_web` (настройки оповещений). По умолчанию включены `order_reference`, `created_at`, `comment` (`notes`), `items`, `quantity`, `status`, `item_base_total`, `base_total`. Имя клиента, телефон, адрес, ориентир, клиентская сумма (`order_total`), `line_total`, `profit` и создатель по умолчанию не возвращаются. Сохранённые владельцем настройки имеют приоритет над этими значениями по умолчанию.
- Цена для аптеки — базовая (цена аптеки), как в Telegram-оповещении аптеки: в `medicines[]` поля `base_unit_price = COALESCE(base_unit_price, price)` и `base_line_total = base_unit_price * quantity` (оба — десятичные строки из SQL), в заказе — `base_total` (сумма `base_line_total`). `item_base_total` управляет `base_unit_price` и `base_line_total`, `base_total` — итогом. Если они выключены, поля отсутствуют, и экран не показывает столбцы «Цена»/«Сумма» и строку «Итого». Экран не пересчитывает суммы в JS.
- Всегда (вне политики, без данных клиента) возвращаются `waiting_since` и `awaiting_response`. С задачи 010: `awaiting_response = true`, пока заказ `pending` и у этой аптеки есть назначенная позиция без её ответа; `waiting_since` — самое раннее `COALESCE(oi.pharmacy_assigned_at, o.created_at)` среди таких позиций (для «Ватан 2» отсчёт идёт с момента передачи), иначе `created_at`. Экран показывает «Ожидает обработки N мин» только при `awaiting_response: true`: до 10 мин нейтрально, 10–19 мин жёлтым, от 20 мин красным; счётчик обновляется раз в 30 с без перезагрузки. Старая Lambda без этих полей: бейдж, цены и кнопки ответа не показываются.
- **Ответ фармацевта по позициям (задача 010).** `POST /v1/staff/orders/{order_id}/pharmacy-answers` (только аптека, `session_account(pharmacy=True)`; курьер → `403`). Аптека берётся только из сессии.
  - Тело: `{ "answers": [{ "order_item_id": 81, "answer": "available" }, { "order_item_id": 82, "answer": "price_differs", "problem": "цена 45 вместо 40" }] }`. Ровно ключ `answers`; в каждой записи ровно `order_item_id` и `answer`, плюс необязательный `problem` (и с задачи 011 — `base_unit_price` для «Ватан 2», см. ниже). Любые другие ключи (цены клиента, `pharmacy_id`) → `400`. 1–50 записей, без повторов `order_item_id`. `problem` (пробелы схлопываются): обязателен для `price_differs` (3–300 символов), необязателен для `unavailable` (если указан — 3–300), запрещён для `available`.
  - Ошибки: валидация → `400 VALIDATION_ERROR`; нет заказа, он удалён, не с сайта или у этой аптеки нет в нём ни одной позиции → `404 ORDER_NOT_FOUND`; статус ≠ `pending` → `409 ORDER_STATUS_CONFLICT`; позиции нет в заказе → `404 ORDER_ITEM_NOT_FOUND`; позиция назначена другой аптеке → `403 FORBIDDEN`. При любой ошибке ничего не пишется.
  - Строка заказа блокируется `FOR UPDATE`, позиции — `FOR UPDATE OF oi`. Ответы пишутся upsert-ом в `order_item_pharmacy_answers (order_item_id, pharmacy_id, answer, problem, answered_at, answered_by = 'staff:N')`. Аптека может менять свой ответ, пока заказ `pending` и позиция у неё.
  - **Маршрутизация:** `unavailable` от «Ватан 1» в той же транзакции ставит позиции `fulfillment_pharmacy_id = 2`, `pharmacy_assigned_at = now()`; уходят только эти позиции. После этого «Ватан 1» не может изменить ответ по ней (`403`), кроме точного повтора. `price_differs` не маршрутизируется. `unavailable` от «Ватан 2» окончательный («нет ни в одной аптеке»), обратно в «Ватан 1» ничего не уходит; позиции заказов, изначально назначенных «Ватан 2», в «Ватан 1» не уходят.
  - Повтор того же запроса — no-op без записи и без аудита, ответ тот же. Каждый изменяющий запрос пишет одну строку `admin_audit_log`: `actor_id = 'staff:N'`, `action = 'pharmacy.order.items_answered'`, `details = {pharmacy_id, items: [{order_item_id, answer}], routed_to_pharmacy_2: [ids]}` без данных клиента. `orders.status` и `order_status_history` не меняются.
  - Ответ: `{ order_id, items: [{order_item_id, my_answer, my_problem}], routed_away_count, awaiting_response }` по позициям этой аптеки.
  - **Правки администратора:** изменение количества (`item-adjustments`, повторное добавление того же товара через `POST /v1/admin/orders/{id}/items`) или базовой цены (`order_item_id` + `base_unit_price`) удаляет ответ текущей аптеки этой позиции; назначение сохраняется. Изменение только цены клиента ответ не удаляет. Новые позиции начинают без назначения (аптека заказа).
  - Next.js: `POST /api/staff/orders/{order_id}/pharmacy-answers` проверяет тело той же валидацией (`src/lib/pharmacy-answers.ts`) и проксирует с серверной сессией. Экран: «В наличии, цена верна» отвечает `available` по всем неотвеченным позициям; «Нет в наличии / цена отличается» открывает выбор по каждой позиции с полем проблемы.
  - Миграция `db/migrations/0024_order_item_pharmacy_answers.sql` (аддитивная): применить **до** деплоя Lambda, иначе списки заказов аптеки и курьера перестанут работать. Telegram-оповещения не меняются: «Ватан 2» узнаёт о переданных позициях только на экране `/staff/orders`.
- **Сборка: «Начать сборку» / «Сборка сделана» (задача 011, доработка 1).** Внутренние отметки аптеки по своей части заказа. Сборка идёт, пока заказ «Новый» (`pending`), до звонка курьера клиенту; уже согласованные заказы тоже принимают отметки. Статусы клиента (`pending → confirmed → delivering → delivered`) и `/tracking` не меняются, новых статусов нет.
  - Поток: «Ватан 1» нажимает «Начать сборку»; позицию, которой нет, отмечает «Нет в наличии» (ответ задачи 010) — она автоматически уходит в «Ватан 2»; остальное собирает и нажимает «Сборка сделана». «Ватан 2» по каждой переданной позиции: «В наличии» (цену аптеки можно оставить или изменить и сохранить) или «Нет в наличии», затем «Собрано». Часть «Ватан 2» становится «Собран», когда каждая её позиция «Собрано» или «Нет в наличии». Когда все аптеки сборки «Собран», курьер звонит клиенту и нажимает «Согласовано» (`pending → confirmed`, см. §8.1.2).
  - В списке аптеки вне политики `pharmacy_web` (без данных клиента) в каждом заказе: `assembly_state` (`null` = «Ждёт сборки», `assembling`, `assembled`) — отметка этой аптеки; `assembly_available` — `true`, если статус `pending` или `confirmed` и у этой аптеки есть позиция для сборки (назначена ей, и её ответ не `unavailable`; позиция без ответа считается). В каждой позиции `medicines[]`: `routed_here` (позиция передана сюда из «Ватан 1», `pharmacy_assigned_at IS NOT NULL`) и `collected` (эта аптека отметила «Собрано»). Если политика показывает состав (`items`) — `routed_away`: позиции, которые эта аптека передала другой, `[{order_item_id, medicine_name, quantity?, pharmacy_id, answer}]` с ответом той аптеки (`quantity` — по политике `quantity`). Поля задачи 010 не меняются.
  - `POST /v1/staff/orders/{order_id}/assembly` (только аптека, `session_account(pharmacy=True)`; курьер → `403`). Тело ровно `{ "state": "assembling" }` или `{ "state": "assembled" }`; любые другие ключи (включая `pharmacy_id`) и значения → `400 VALIDATION_ERROR`. Аптека берётся только из сессии.
    - Ошибки (по порядку под `FOR UPDATE` строки заказа): нет заказа, он удалён, не с сайта или у аптеки нет в нём назначенных позиций → `404 ORDER_NOT_FOUND`; статус не `pending`/`confirmed` → `409 ORDER_STATUS_CONFLICT` «Сборка доступна только для нового или согласованного заказа»; все позиции этой аптеки «Нет в наличии» → `409 NOTHING_TO_ASSEMBLE` «Нечего собирать»; возврат (`assembled` → `assembling`) → `409 ASSEMBLY_STATE_CONFLICT` «Заказ уже отмечен «Собран»» (с задачи 015 переход нет отметки → `assembled` разрешён). При любой ошибке ничего не пишется.
    - Переходы только вперёд: нет отметки → `assembling` → `assembled`; снять отметку нельзя. Переход — upsert строки `(order_id, аптека сессии)` в `order_pharmacy_assembly`; `assembled` ставит `assembled_at = now()`. «Сборка сделана» на заказе `pending` записывает `available` по ещё неотвеченным позициям этой аптеки (они собраны), чтобы курьер получил подтверждённую сумму. Повтор текущего состояния — no-op без записи и аудита. Каждое изменение пишет одну строку `admin_audit_log`: `action = 'pharmacy.order.assembly_marked'`, `details = {pharmacy_id, from_state, to_state}` и, если были такие позиции, `answered_available: [ids]`; без данных клиента. `orders.status` и `order_status_history` не меняются.
    - Ответ: `{ order_id, pharmacy_id, state, started_at, assembled_at }`.
  - `POST /v1/staff/orders/{order_id}/assembly/items` — «Собрано» по одной позиции (только аптека). Тело ровно `{ "order_item_id": 82 }`. Позиция должна быть назначена аптеке сессии (`403 FORBIDDEN`, иначе), заказ `pending`/`confirmed` (`409 ORDER_STATUS_CONFLICT`), её ответ — `available` (`409 ITEM_NOT_AVAILABLE` «Сначала отметьте «В наличии»»); нет позиции → `404 ORDER_ITEM_NOT_FOUND`. Пишет `order_item_assembly (order_item_id, pharmacy_id, collected_at, collected_by)` и одну строку аудита `pharmacy.order.item_collected` `{pharmacy_id, order_item_id}`; повтор — no-op. Часть аптеки следует за позициями одним SQL: хотя бы одна «Собрано» → `assembling`, все позиции «Собрано» или «Нет в наличии» → `assembled` (только вперёд; то же пересчитывается после ответов этой аптеки). Ответ: `{ order_id, order_item_id, pharmacy_id, collected: true, assembly_state }`.
  - **Цена «Ватан 2» при сборке.** В `POST .../pharmacy-answers` запись с `answer: "available"` может содержать `base_unit_price` (строка или число, 0,01–999 999,99, не больше двух знаков; запятая допускается) — только для аптеки 2 (`403` для аптеки 1) и только с `available` (`400` иначе). Это лишь ввод: Lambda ставит `base_unit_price`, пересчитывает цену клиента по сохранённому правилу наценки `vatan_selling_unit_price(base)` (как при оформлении), `line_total = ROUND(selling × quantity, 2)` и итоги заказа (`items_subtotal = order_total = total_price = SUM(line_total)`, как правка базовой цены администратором), пишет аудит `pharmacy.order.item_price_changed` `{pharmacy_id, items: [{order_item_id, previous_base_unit_price, new_base_unit_price, new_selling_unit_price}]}`. Та же цена — не изменение. Суммы от клиента не принимаются.
  - Правки администратора после сборки (количество, базовая цена) отметки не сбрасывают, поэтому «Собран» может устареть.
  - Next.js: `POST /api/staff/orders/{order_id}/assembly` и `POST /api/staff/orders/{order_id}/assembly/items` проверяют тело той же валидацией (`src/lib/pharmacy-assembly.ts`) и проксируют с серверной сессией. Карточка аптеки при `assembly_available: true` показывает отметку («Сборка: Ждёт сборки / Собирается / Собран») и кнопку «Начать сборку» → «Сборка сделана» (у «Ватан 2», где все позиции переданы, вместо неё — блок «Переданы из Ватан 1» с действиями по позициям); при `409` — сообщение и обновление карточки. Цвета: переданная и есть в «Ватан 2» — оранжевая «В аптеке 2», нет в обеих — красная «Нет в наличии в обеих аптеках»; у «Ватан 1» под «Передано в Ватан 2» — список с этими метками. Без новых полей (старая Lambda) кнопок нет. Статус `confirmed` на карточке аптеки подписан «Согласован».
  - Миграция `db/migrations/0025_order_pharmacy_assembly.sql` (аддитивная): таблицы `order_pharmacy_assembly (order_id, pharmacy_id, state, started_at, assembled_at, updated_by)`, PK `(order_id, pharmacy_id)`, и `order_item_assembly (order_item_id, pharmacy_id, collected_at, collected_by)`, PK `(order_item_id, pharmacy_id)`; обе `ON DELETE CASCADE`. **Порядок выкладки:** 1) применить 0025 к RDS; 2) задеплоить `admin-api-v1.zip`; 3) задеплоить Vercel. Новая Lambda без 0025 ломает списки заказов аптеки и курьера и «Согласовано». После деплоя «Новые» заказы с сайта нельзя согласовать, пока аптеки не отметят сборку. Оповещений об отметках нет (задача 012).
- **Оповещения аптеки (задача 012; правило `needs_attention` заменено задачей 013, см. ниже).** В каждом заказе списка аптеки вне политики `pharmacy_web` (без данных клиента, без миграции, без новых записей в БД):
  - `needs_attention: boolean` — `true`, пока эта аптека не отреагировала на заказ: нет её отметки сборки (`order_pharmacy_assembly`), нет её ответа (010) ни по одной назначенной ей позиции, нет «Собрано» по позиции и нет её ответа по позиции, которая уже передана другой аптеке (`routed_away_count = 0`; «Нет в наличии» от «Ватан 1» уводит позицию из её списка, но это тоже реакция). Действует для `pending` и `confirmed`.
  - `attention_since: ISO | null` — не `null` только при `needs_attention: true`: самое раннее `pharmacy_assigned_at` назначенных позиций, если все они переданы сюда (для «Ватан 2» отсчёт с момента передачи), иначе `created_at` заказа.
  - Экран (`src/components/PharmacyOrderAlerts.tsx` в `StaffShell` для роли `pharmacy`) опрашивает `GET /api/staff/orders` (первая страница очереди) каждые 30 с и сразу при возврате на вкладку. Заказ с `needs_attention: true` вызывает тост «Новый заказ № {order_reference}» / «Ожидает ответа N мин» при первом появлении на странице и затем не чаще раза в 180 с (`REMIND_MS`, `src/lib/pharmacy-alerts.ts`); при `needs_attention: false` или уходе из очереди тост убирается и повторы прекращаются. Заголовок вкладки — `(N)`, на `/staff/orders` — плашка «Новых заказов без ответа: N» и панель разрешения уведомлений. Звук — по кнопке «Включить звук» (ключ `localStorage` `vatan-pharmacy-sound`, отдельно от курьерского `vatan-order-sound`); после перезагрузки звук включается первым касанием. Системное уведомление — только при разрешении и скрытой вкладке, в `try/catch`. Текст тоста, уведомления и заголовка — только номер заказа и минуты, без данных клиента при любой политике. Старая Lambda без `needs_attention` — без напоминаний. Web Push при закрытом приложении — отдельная задача 012b.
- **Задача 013: этапы, строки «Ватан 1», напоминания до «Сборка сделана», Telegram об изменениях.**
  - В заказе очереди аптеки вместе с полем `status` (политика `pharmacy_web`, поле `status`) возвращается `stage`;
    чип карточки: «Собирается» / «Собран» / «Подтверждён».
  - `needs_attention` (вне политики, без данных клиента) — `true`, пока заказ в очереди (`pending`/`confirmed`, живой
    заказ с сайта), у этой аптеки есть что собирать (позиция без её ответа `unavailable`) и её отметка не `assembled`.
    Ответы, «Начать сборку» и передача позиций напоминания больше не останавливают; для «Ватан 2» часть становится
    `assembled` через «Собрано» по последней позиции. `attention_since` — `created_at`, а если все позиции этой
    аптеки переданы ей — самое раннее `pharmacy_assigned_at`.
  - Экран (интервалы, длительность и кнопка звука заменены задачей 014, см. ниже): обе аптеки на каждом напоминании играют сигнал длиной 10 с (`PHARMACY_ALARM_SECONDS = 10`, новый сигнал
    останавливает предыдущий, сигнал прекращается, когда ждущих заказов нет или звук выключен); интервалы —
    60 с для «Ватан 1», 180 с для «Ватан 2». Текст: «Ждёт сборки N мин», баннер «Заказов ждут «Сборка сделана»: N».
  - Таблица лекарств: у каждой своей позиции заказа `pending` — «В наличии», «Нет в наличии», «Изменить цену» →
    «Сохранить» (тот же `POST .../pharmacy-answers`: `order_item_id`, `answer`, необязательно `base_unit_price`).
    Позиции, переданные в «Ватан 2» (`routed_away`), остаются в той же таблице по `order_item_id`, только для
    чтения: оранжевый «Ватан 2» (ждёт ответа или есть там), красный «Нет в наличии в обеих аптеках». Отдельного
    списка «Передано в Ватан 2» и формы задачи 010 больше нет; «Цена отличается» в интерфейсе не предлагается
    (Lambda по-прежнему принимает `price_differs`). Позиции «Ватан 2», пришедшие из «Ватан 1», — прежние
    поштучные кнопки (задача 014: те же строки таблицы, что и у «Ватан 1»).
  - **Цена «Ватан 1».** `403 «Цену при сборке меняет только «Ватан 2»»` удалён: обе аптеки передают `base_unit_price`
    только с `available` для своей позиции заказа `pending`; путь тот же (`_reprice_items_from_base`:
    `vatan_selling_unit_price`, пересчёт строки и итогов в SQL, одна строка аудита
    `pharmacy.order.item_price_changed`, `actor_id = 'staff:N'`). Повтор той же цены ничего не пишет.
  - **Уведомление об изменении.** Если запрос изменил цену или передал позицию в «Ватан 2», ответ Lambda содержит
    `_notification`: `{notification_kind: "pharmacy_item_change", admin_order_id, order_id, order_reference,
    pharmacy_id, event_key: "order:{id}:pharmacy-change:{request_id}", changes: [{kind: "price" | "routed",
    medicine_name, quantity, old_base_unit_price, new_base_unit_price, old_selling_unit_price,
    new_selling_unit_price}]}` (цены только у `price`; без имени, телефона, адреса, ориентира и комментария
    клиента). Next.js `POST /api/staff/orders/{id}/pharmacy-answers` удаляет поле до ответа браузеру и вызывает
    notifier после отправки ответа (`after()`, try/catch: ошибка только логируется, ответ остаётся `200` и не ждёт Telegram).
  - Claim `POST /v1/admin/order-notification-deliveries/claim` принимает `order:N:pharmacy-change:req_<32 hex>`
    только для `owner_telegram` и `courier_telegram` (`courier_enabled` / `courier_enabled_since` как раньше);
    `pharmacy_telegram` и любые другие ключи → `400`. Notifier отправляет одно сообщение владельцу (с кнопкой
    админки) и, если claim получен, одно курьеру (только «📦 Открыть заказ»), например «Заказ № … · Ватан 1» и
    «• «Парацетамол» × 2 — передано в Ватан 2» / «— цена изменена: 40.00 → 45.00 с.». Базовые цены — только при
    `item_base_total`, цены клиента — только при `item_client_total` политики получателя. Повторный claim того
    же ключа ничего не отправляет. Без миграции и новых переменных окружения.
  - Деплой (не часть задачи): admin Lambda → notifier → public Lambda → Vercel.
- **Задача 014: звук всегда включён, сигнал по настройкам владельца, «Ватан 2» после передачи, один формат заказа.**
  - **Настройки сигнала аптек.** `GET /v1/admin/order-notification-settings` (только admin) дополнительно
    возвращает `pharmacy_alarm: {ringtone, duration_seconds, interval_seconds}`. `PATCH` той же страницы и
    `POST /v1/admin/order-notification-preview` требуют ровно четыре ключа: `courier_enabled`, `policies`,
    `revision`, `pharmacy_alarm` (отсутствующий или лишний ключ → `400 VALIDATION_ERROR`). `ringtone` — один из
    `classic`, `bell`, `pulse`, `melody`; `duration_seconds` — целое 5–120; `interval_seconds` — целое 30–600;
    `duration_seconds ≤ interval_seconds`; `bool`, дробные числа и строки → `400`. Без миграции: значение хранится
    в той же JSONB `order_notification_settings.policies` под зарезервированным ключом `pharmacy_alarm`; политики
    каналов читаются только по `CHANNELS`, поэтому ключ в них не попадает. Строка без ключа (сохранённая до задачи
    014 или старой Lambda) читается как `classic` / 60 / 60. Аудит `order.notification_settings_updated`
    содержит прежний и новый `pharmacy_alarm`.
  - **Очередь аптеки.** `GET /v1/staff/orders` для аптеки 1 и 2 возвращает верхнеуровневое `alarm`
    (`{ringtone, duration_seconds, interval_seconds}`, без данных клиента, из той же строки настроек — нового
    запроса нет). Клиент (`parseAlarmConfig`, `src/lib/pharmacy-alerts.ts`) ограничивает значения теми же
    пределами и при отсутствии поля (старая Lambda) берёт `classic` / 60 с / 60 с.
  - **Экран аптеки.** Один интервал для обеих аптек (по умолчанию 60 с, `REMIND_MS`); на каждом напоминании
    звучит выбранная мелодия заданной длительности (`schedulePharmacyAlarm`, `src/lib/pharmacy-alarm.ts`, громкость
    ≤ 0,22), новое напоминание останавливает предыдущий сигнал, сигнал прекращается, когда ждущих заказов нет.
    Звук нельзя выключить: `AudioContext` создаётся при открытии страницы и сразу пробует `resume()` (установленное
    приложение Chrome/Edge или сайт с разрешённым звуком играют без касания); если браузер блокирует звук, его
    включает первое `pointerdown` / `keydown` / `touchstart` в любом месте страницы. Кнопка — только индикатор:
    «Звук включён» или «Звук включён — коснитесь экрана». При разрешённых уведомлениях каждое напоминание также
    создаёт системное уведомление (видима вкладка или нет) с `tag: pharmacy-<order_id>`, `renotify: true` и текстом
    только из номера заказа и минут.
  - **«Ватан 2» после передачи.** Если «Ватан 1» передаёт позицию, а часть «Ватан 2» уже `assembled` (например,
    она собрала прежнюю переданную позицию), в той же транзакции выполняется
    `UPDATE order_pharmacy_assembly SET state = 'assembling', assembled_at = NULL ... WHERE order_id = … AND
    pharmacy_id = 2 AND state = 'assembled'` и пишется аудит `pharmacy.order.assembly_reopened`
    (`actor_id = 'staff:1'`, `{pharmacy_id: 2, from_state, to_state, routed_order_item_ids}`; одна SQL-команда,
    аудит только если отметка действительно сброшена). «Ватан 2» снова получает `needs_attention: true`, этап
    заказа уходит из «Собран», «Согласовано» курьера снова ждёт «Сборка сделана». Уже собранные позиции остаются
    «Собрано».
  - **Один формат заказа.** «Ватан 1» и «Ватан 2» видят одну таблицу (`PharmacyItemRow`): у своей позиции заказа
    `pending` маленькие «В наличии» / «Нет в наличии» рядом с суммой; «Нет в наличии» подтверждается в строке в
    обеих аптеках («Передать в Ватан 2?» / «Нет в обеих аптеках?»); нажатие на цену открывает поле (Enter или «✓» —
    `POST .../pharmacy-answers` с `{answer: "available", base_unit_price}`, Esc или «×» — отмена; при скрытых
    политикой ценах редактора нет). Позиции, переданные в «Ватан 2», — строки той же таблицы с «Собрано»;
    отдельного списка внизу больше нет. «Нет в наличии» у «Ватан 2» показывается как «Нет в наличии в обеих аптеках».
  - **Telegram.** «Нет в наличии» от «Ватан 2» добавляет в `_notification` изменение
    `{kind: "unavailable_both", medicine_name, quantity}`; notifier пишет «• «…» × N — нет в наличии в обеих
    аптеках». Notifier, не знающий этот `kind`, просто пропускает строку.
  - Деплой (не часть задачи): admin Lambda и notifier (notifier не позже admin), затем Vercel. Frontend терпит
    отсутствие `alarm` и `pharmacy_alarm`. Между деплоем новой Lambda и Vercel старая страница настроек не сможет
    сохранить настройки (нет `pharmacy_alarm` → `400`); откат admin Lambda: старая Lambda при сохранении
    перезапишет `policies` без `pharmacy_alarm`, и действуют значения по умолчанию.
- **Задача 015: одна панель сборки для «Ватан 1» и «Ватан 2» — «Нет в наличии», цена, одна кнопка «Собран».**
  - **Поток.** Пришло оповещение → аптека собирает лекарства → если цена не совпадает, нажимает на цену и
    меняет её; если позиции нет — «Нет в наличии» (с подтверждением в строке: у «Ватан 1» позиция уходит в
    «Ватан 2», у «Ватан 2» — «нет в обеих аптеках») → нажимает одну «Собран» под таблицей. Всё, что не отмечено
    «Нет в наличии», считается в наличии. Кнопок «В наличии», «Начать сборку», «Сборка сделана» и поштучной
    «Собрано» на экране больше нет; уже собранные позиции сохраняют метку «Собрано». Панель одинакова у обеих
    аптек, включая «Ватан 2», у которой все позиции пришли из «Ватан 1». Подтверждения у «Собран» нет.
  - **`POST /v1/staff/orders/{order_id}/assembly`.** `_ASSEMBLY_TRANSITIONS` дополнен переходом нет отметки →
    `assembled`: `{ "state": "assembled" }` без «Начать сборку» пишет один upsert `order_pharmacy_assembly`, на
    заказе `pending` — `available` по неотвеченным позициям этой аптеки (так сервер обеспечивает «не отмечено =
    в наличии»), и одну строку аудита `pharmacy.order.assembly_marked` с `from_state: null`. `assembling` →
    `assembled` работает как раньше (`assembling` остаётся для старых клиентов и повторного открытия «Ватан 2»
    задачей 014). Повтор — no-op без записи, аудита и `_notification`. `orders.status` не меняется.
  - **Только чтение после «Собран».** `POST .../pharmacy-answers` от аптеки, чья часть `assembled`, под тем же
    `FOR UPDATE` строки заказа → `409 ASSEMBLY_STATE_CONFLICT` «Заказ уже отмечен «Собран»», ничего не пишется.
    Экран скрывает кнопки строк при `assembly_state === 'assembled'`. Если «Ватан 1» позже передаёт позицию,
    повторное открытие задачи 014 возвращает «Ватан 2» в `assembling`, и её ответы снова принимаются. Отмены
    «Собран» аптекой нет (ошибку исправляет владелец).
  - **Уведомление «Заказ собран».** Если этот «Собран» завершил сборку всего заказа (все аптеки сборки по
    `_ORDER_ASSEMBLY_PARTS_SQL` — `assembled`, в той же транзакции), ответ Lambda содержит `_notification`:
    `{notification_kind: "pharmacy_order_assembled", admin_order_id, order_id, order_reference, pharmacy_id,
    event_key: "order:{id}:assembled:{request_id}", parts: [{pharmacy_id, items: [{medicine_name, quantity}]}],
    missing: [{medicine_name, quantity}], client_total}` — `missing` — позиции, на которые их текущая аптека
    ответила «Нет в наличии»; без имени, телефона, адреса, ориентира и комментария клиента. Когда «Собран» нажала
    первая из двух аптек — уведомления нет (частичных сообщений нет). Next.js `POST /api/staff/orders/{id}/assembly`
    удаляет поле до ответа браузеру и вызывает notifier в `after()` (ошибка только логируется, ответ `200`).
  - **Claim и notifier.** Claim принимает `order:N:assembled:req_<32 hex>` только для `owner_telegram` и
    `courier_telegram` (`courier_enabled` / `courier_enabled_since` как раньше); `pharmacy_telegram` и неверные
    ключи → `400`; ключ помещается в `VARCHAR(100)`. Повторный claim ничего не отправляет; после повторного
    открытия и нового «Собран» ключ новый (по `request_id`). Notifier (`format_order_assembled_message`): одна
    аптека — «✅ Заказ № … собран, лежит в Ватан 1» (или «в Ватан 2»); разделённый заказ — «✅ Заказ № … собран»
    и строки «В Ватан 1: «A» × 1, «B» × 2», «В Ватан 2: «C» × 1»; если есть — «Нет в наличии: «D» × 1»; строка
    «Сумма: N с.» — только при `client_total` в политике получателя. Владельцу — с кнопкой админки, курьеру —
    только «📦 Открыть заказ». Аптеке не отправляется.
  - Без миграции и новых переменных окружения. Деплой (не часть задачи): admin Lambda → notifier → Vercel. Новый
    экран со старой Lambda на неотмеченной части получит `409` «Сначала нажмите «Начать сборку»», поэтому Lambda
    первой. `POST .../assembly/items` остаётся в Lambda, экран его не вызывает.
- Экран `/staff/orders` аптеки следует политике `pharmacy_web`, которую уже применила Lambda: поле показывается, если оно есть в ответе (владелец включил его в настройках оповещений), и скрыто, если его нет. Так выводятся имя клиента, телефон (ссылка `tel:`), адрес, ориентир, источник, создатель («Сайт» / «Сотрудник N»), столбец «Клиенту» (`line_total`, только если он есть у всех позиций), клиентская сумма (`order_total`) и разница (`profit`). По умолчанию все эти поля выключены, поэтому аптека их не видит. Модель карточки — `pharmacyOrderView` в `src/lib/pharmacy-order.ts`.
- Изменения задачи 008 вступают в силу после деплоя `admin-api-v1.zip`; задача 010 требует сначала миграцию 0024, затем деплой Lambda; задача 011 — сначала миграцию 0025, затем Lambda, затем Vercel.

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

### 8.3 Ручная отметка «Нет в наличии»

- `PATCH /v1/admin/medicines/{medicine_id}/visibility` с телом `{ "hidden_from_clients": true }` скрывает лекарство от клиентов, `false` возвращает. Другие поля или не-boolean → `400 VALIDATION_ERROR`, неизвестный `medicine_id` → `404 MEDICINE_NOT_FOUND`. Ответ: `{ medicine_id, medicine_name, hidden_from_clients, hidden_from_clients_at }`; в `admin_audit_log` пишется `medicine.hidden_from_clients` или `medicine.shown_to_clients`.
- Отметка хранится отдельно от `in_stock`: синхронизация аптеки (DBF) её не меняет.
- `GET /v1/admin/medicines` возвращает `hidden_from_clients` и принимает `availability=hidden` (только отмеченные).
- Публичный API считает лекарство продаваемым, только если `in_stock = true` и `hidden_from_clients = false`: поиск, карточка (`404`), избранное, карусели, категории и подборки его не показывают; `resolve` отдаёт `in_stock: false`; `create_order` отвечает `409 ORDER_ITEMS_UNAVAILABLE`.

## 9. Internal catalog sync

`agent_sync.exe` не обращается к RDS. С отдельной machine identity он:

1. вызывает `POST /v1/internal/catalog-syncs` с `source_updated_at`, file metadata и SHA-256;
2. загружает большой snapshot по короткоживущему pre-signed S3 URL;
3. вызывает idempotent `POST /v1/internal/catalog-syncs/{sync_id}/commit`;
4. читает status через `GET /v1/internal/catalog-syncs/{sync_id}`.

Sync Lambda проверяет checksum/schema, применяет правило ведущего `*`, валидирует весь snapshot в staging и только затем атомарно публикует его. Upsert сохраняет существующие `medicine_id`; полный snapshot не пересоздаёт primary keys. Ошибка не оставляет частично обновлённый каталог. Final states: `succeeded` или `failed`; history содержит counts и безопасные причины ошибок.

Подтверждённая схема `OSTATKI.DBF`: `NAME`, `PRICE`, `COUNTRY`, `PROIZVOD`; стабильный SKU отсутствует. Fallback identity — SHA-256 от нормализованного `source_id + NAME + PROIZVOD + COUNTRY`. Повторы fallback identity объединяются по правилу `available first -> maximum base price -> first DBF row`; усреднение цены не допускается. Количество и номера объединённых строк записываются в безопасный sync audit. Дублированный непустой `source_sku`, если поле появится в будущем, отклоняет snapshot.

## 9.1 Internal pharmacy mirror (теневой режим)

Агент `pharmacy_agent.exe` (`backend/pharmacy_agent`) читает Oracle «Алгоритма» под пользователем только для чтения и зеркалит выбранные таблицы в `pharmacy_mirror_rows` (миграция `0027`). Витрина (`medicines`) этим маршрутом не меняется.

Пакет `POST .../batches`:

```json
{
  "batch_id": "uuid",
  "pharmacy_id": 1,
  "table": "T_SKLAD_STATE",
  "generated_at": "2026-10-19T10:00:00+00:00",
  "upserts": [{"key": "10", "change_id": 8639132, "data": {"SKLAD_STATE_ID": 10, "PRODUCT_COUNT_SKLAD": "0.000334"}}],
  "deletes": ["11"]
}
```

- `table` — только из allowlist `DEFAULT_MIRROR_TABLES` (товары, остатки, партии, справочники; без чеков, карт и сотрудников) или из `PHARMACY_MIRROR_TABLES`.
- `data` — все непустые колонки строки, имена колонок Oracle в верхнем регистре, только скалярные значения; нецелые `NUMBER` передаются строкой, даты — ISO-8601. До 5000 строк и 20000 удалений на пакет.
- Пакет применяется в одной транзакции. Повтор того же `batch_id` ничего не меняет и возвращает `already_applied: true`.
- Агент отправляет пакеты строго последовательно и отмечает их отправленными только после ответа 2xx, поэтому `generated_at` носит справочный характер: часам компьютера аптеки сервер не доверяет.
- Удаления определяет агент полной сверкой таблицы; если сверка видит меньше половины ранее отправленных строк, удаления не отправляются.

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

## Read-only Oracle shadow mirror (admin)

All routes require the existing admin identity in Lambda and an admin session in
the Next.js server layer. Agent bearer credentials are never used by this UI.
Responses use `{data, request_id}` and `Cache-Control: no-store`.

| GET route | Query / response data |
| --- | --- |
| `/v1/admin/pharmacy-mirror/status` | No query parameters. Pharmacy 1 connection/batch timestamps, last batch metadata, `checked_at`, `freshness`, and all 12 tables with `row_count`, `max_change_id`, `last_received_at`, `source_generated_at`, `freshness`. |
| `/v1/admin/pharmacy-mirror/products` | `q` (max 120 characters), `mode=auto\|name\|id\|barcode`, `page=1..9999`, `limit=25` only. Returns `items,total,page,limit,mode`. Name substring: at least 2 characters, literal `%`, `_`, `\`. Numeric auto mode finds exact PRODUCT_ID, product SCAN_CODE or batch INCOME_SCAN_CODE. |
| `/v1/admin/pharmacy-mirror/products/{product_id}` | Digit ID, up to 18 characters. `stock_page` and `income_page` (1..9999, independent 25-row pages). Product, six dictionary lookups, full stock aggregate, paginated stock and income rows, safe Oracle fields, timestamps/change IDs, `checked_at`, explicit unavailable site comparison. |

Unknown parameters/invalid pagination return 400; missing admin identity returns
403; missing product returns 404. Mirror mutations return 405 after authorization.
Stock is `SUM(PRODUCT_COUNT_SKLAD)` without subtracting reserves or converting units.
Missing stock rows differ from zero. Malformed numeric source fields are counted
and surfaced instead of silently publishing a partial aggregate. Price/date fields
keep their Oracle names until their business meaning has been checked by the owner.
Per-row JSON contains only explicitly allowed product/stock/income scalar fields.

The UI is `/admin/pharmacy-mirror`. It refreshes visible tabs every 60 seconds;
table freshness measures last changed-row reception, while connection freshness
uses `pharmacy_sources.last_seen_at` (stale after 180 seconds). Unchanged dictionaries
may be old while the agent remains connected. No storefront writes or matching by name.

Price display extension (2026-10-22): product list items and detail `stock` also
contain nullable decimal strings `sale_price_min/max`, `purchase_price_min/max`,
`sale_value`, `purchase_value`, and `price_basis` (`in_stock`, `historical`, `none`).
Sale means source level 1 `OUTCOME_PRICE_ONE_W_NDS`; purchase means
`INCOME_PRICE_W_NDS`, joined by pharmacy + INCOME_ID + PRODUCT_ID. Ranges use
positive-stock batches, falling back to historical batches only if none has
positive stock. Values sum each batch's quantity × its own price; missing prices
for nonzero batches make the relevant value null. Stock rows also include
`purchase_price` and `income_barcode` from that exact income. No data writes.

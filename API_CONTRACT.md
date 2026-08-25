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
| `GET /v1/public/categories/{slug}/medicines` | Товары категории | `get_category_medicines` |
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
- Ordering: точное совпадение, начало названия, полная фраза, количество совпавших слов, fuzzy `word_similarity`, затем `medicine_name ASC` и `medicine_id ASC`.
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
- `GET /v1/public/categories/{slug}/medicines?limit=20&cursor=...` возвращает только sellable medicines.
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
- Rate limit применяется по IP и hash нормализованного телефона; raw phone не пишется в access logs.
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
- Create order и tracking имеют отдельные per-IP/phone-hash rate limits.
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

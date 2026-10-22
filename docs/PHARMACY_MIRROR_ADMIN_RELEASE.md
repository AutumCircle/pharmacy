# Проверка теневого зеркала аптеки — 22 октября 2026

Реализация использует существующую Oracle-синхронизацию из `805f3a7` и актуальный
`origin/main` (`07f1603`). Исходная грязная рабочая копия сохранена; работа выполнена
в отдельном worktree, ветка `codex/pharmacy-mirror-admin`.

## Проверенные факты и ограничения

- Архитектура: браузер → защищённые Next Server Components → REST API Gateway
  `2y9rv4j811`, `eu-central-1`, stage `prod` → Admin Lambda
  `pharmacy-heartbeat-handler` → PostgreSQL RDS `pharmacy-db`.
- Существующий `/v1/admin/{proxy+}` уже интегрирован с Admin Lambda, требует API
  key; Gateway authorizer — NONE. Реальная admin-проверка выполняется в Lambda
  (`require_admin_identity`), дополнительно в server layer (`requireAdminSession`).
  Секрет агента не используется и не читается новым UI.
- Read-only выборка подтвердила PRODUCT_ID/SCAN_CODE, PRODUCT_ID в остатках и
  приходах, INCOME_ID в остатках и приходах, SKLAD_ID и шесть справочников.
  Полная проверка T_PRODUCT: 0 расхождений row_key и PRODUCT_ID.
- На момент проверки: 291 389 товаров, 192 623 строки остатков, 192 623 прихода;
  всего 12 таблиц. T_INCOME не имеет CHANGE_ID: null показывается явно.
- Остаток — точная decimal-сумма PRODUCT_COUNT_SKLAD всех складов. Резерв отдельно,
  единицы не пересчитываются. Некорректные числа не подменяются нулём.
- Все 38 фактически встреченных полей T_PRODUCT разрешены в raw JSON; для
  T_SKLAD_STATE и T_INCOME применены отдельные положительные списки. Поля
  сотрудников/контрагентов из приходов не возвращаются.
- У всех 13 757 строк medicines source_system/source_sku отсутствуют; отдельного
  barcode-поля нет. Однозначное сопоставление с зеркалом не установлено.
  UI объясняет отсутствие сравнения; приблизительного сопоставления нет.
- Семантика ценовых уровней и INCOME_DATE_OLD независимо владельцем пока не
  подтверждена. Поэтому они показаны под исходными Oracle-названиями, без
  утверждения, что конкретный ценовой уровень является ценой витрины.

## Изменённые компоненты

- `backend/v1/shared/pharmacy_mirror_admin.py`: валидация, SELECT-only транзакции,
  timeout 8 секунд, поиск/total/пагинация одним SQL, справочники, агрегаты, статус.
- `backend/v1/admin_api/lambda_function.py`: три узких GET-маршрута после admin auth.
- `src/lib/api-v1/pharmacy-mirror-server.ts`: server-only запросы, admin session,
  единственный API_V1_BASE_URL, timeout 10 секунд, максимум один повтор чтения
  с jitter, no-store и runtime-проверка формы ответа.
- `src/lib/pharmacy-mirror.ts`: типы, runtime-контракты и форматирование.
- `src/app/admin/pharmacy-mirror/`: поиск/карточка, отдельные страницы остатков
  и приходов по 25 строк, Oracle JSON, loading/error/empty states, refresh.
- `src/app/admin/layout.tsx`: ссылка «База аптеки».
- `db/migrations/0028_pharmacy_mirror_admin_indexes.sql`: только индексы.
- `scripts/inspect_pharmacy_mirror.py`, `verify_pharmacy_mirror.py`: фиксированные
  read-only операции, вызываемые через IAM, без публичных маршрутов и произвольного SQL.
- `scripts/apply_pharmacy_mirror_indexes.py`: отдельная IAM-only Lambda миграции,
  фиксированное подтверждение, advisory lock, без автоматических повторов вызова.
- `scripts/verify_pharmacy_mirror_ui.mjs`: браузерная проверка только GET/HEAD.

Точные endpoint contracts приведены в API_CONTRACT.md.

## SQL и индексы

Перед миграцией создан RDS snapshot `pharmacy-pre-mirror-admin-20261022`, статус
`available`. Миграция 0028 additive/idempotent, CREATE INDEX CONCURRENTLY вне
транзакции. Все шесть индексов проверены через pg_index.indisvalid:

1. `pharmacy_mirror_product_name_trgm`: lower(PRODUCT_NAME), GIN pg_trgm, только T_PRODUCT.
2. `pharmacy_mirror_product_barcode`: SCAN_CODE + row_key, только T_PRODUCT.
3. `pharmacy_mirror_stock_product`: PRODUCT_ID + row_key, только T_SKLAD_STATE.
4. `pharmacy_mirror_income_product`: PRODUCT_ID + row_key, только T_INCOME.
5. `pharmacy_mirror_income_barcode`: INCOME_SCAN_CODE + PRODUCT_ID, только T_INCOME.
6. `pharmacy_mirror_admin_status`: pharmacy_id/table_name, INCLUDE времён и CHANGE_ID.

При первом применении один CREATE INDEX был прерван ожиданием блокировки. После
завершения инспекции восстановлен только этот INVALID artifact; валидные индексы
и строки данных не удалялись. Повторный вызов миграции не пересоздаёт валидные индексы.

Полные `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` сохранены в
`docs/evidence/pharmacy-mirror-admin-20261022.json` без credentials/сырых наборов.
Обычный поиск использует GIN, точные штрихкоды — B-tree, справочники — PK,
остатки/приходы — соответствующие expression indexes, статус — Index Only Scan.
Для двух букв нет пригодных триграмм: применяется один последовательный SQL-проход,
с materialized projection для count и страницы, а не двойное сканирование.

Наблюдавшиеся времена сервиса в проверочной Lambda: статус ~0,8 с, название
«парацетамол» ~93 мс, две буквы ~3,5 с, ID ~30 мс, штрихкод ~13 мс,
карточка ~53 мс. Это измерения на конкретном состоянии RDS, не SLA.
Production Gateway smoke: статус 610 мс, название 406 мс, ID 328 мс,
barcode 344 мс, карточка 438 мс. Страница — максимум 25 строк; карточка ~30 KB
на выбранном товаре, без загрузки всей таблицы в Next.js.

## Проверки

- 31 целевой Python test: PASS (admin mirror + исходный mirror + authorization).
- Python compile: PASS.
- 198 существующих frontend tests + 3 новых контрактных теста: PASS.
- Реальные ответы status/products/detail проверены TypeScript runtime-контрактами.
- `npm run lint` и `npm run build` запускаются отдельно и должны завершиться PASS.
- Браузер: анонимный запрос перенаправляется на login; desktop 25 строк, страница 2,
  raw JSON, отсутствие editing controls; mobile 390/320 px без horizontal overflow.
- GET production: status/search/detail/page2 — 200; без admin identity — 403;
  короткое название/limit=100 — 400; действующий список категорий — 200.
- Полный Python suite не зелёный до изменения: чистый исходный merge содержит
  502 tests с 1 failure и 9 errors; текущая версия — 514 tests с теми же 1/9.
  Это баннерный fixture (`title_x`), cursor аналитики, delivered-order audit test
  и 7 Windows cleanup errors открытого SQLite из исходных agent tests.
  Изменения вне текущей задачи для их исправления не вносились.

## Развёртывание и откат

Backend опубликован первым: `pharmacy-heartbeat-handler`, version `10`,
CodeSha256 `ycxqYhEm14vw8zpxD1zbgd3SLZy9UUwM/aSJuq5arEk=`, update Successful.
Состав ZIP сравнен с резервной копией: новый admin module, исходный mirror module,
добавочная agent auth helper из ветки синхронизации и точечный handler dispatch.
Старые тела функций авторизации не менялись. Синхронизирующие Lambda не публиковались.

Исходный backend ZIP сохранён в игнорируемом
`build/mirror-release/pharmacy-heartbeat-handler-before.zip`, исходный CodeSha256
`VhMiLrXeADwP34cma2UmfkxXZRJZClq2xTiyRGUbkTw=`.
Для отката backend загрузить этот ZIP только в pharmacy-heartbeat-handler и
проверить SHA. Для frontend вернуть прежний Vercel Production deployment
`https://pharmacy-99j2ifdqf-michael-c8be.vercel.app` (исходный commit `07f1603`).
Индексы можно оставить. При необходимости удалить только шесть перечисленных
индексов командами DROP INDEX CONCURRENTLY IF EXISTS после отката UI/backend.
Нельзя восстанавливать snapshot поверх продолжающихся изменений агента ради
отката кода. Oracle, medicines, заказы и категории этот интерфейс не изменяет.

Временные inspection/index Lambda следует удалить после проверки релиза;
они не имеют API Gateway интеграций. Production Vercel проверяется по GitHub
deployment status и GET smoke после публикации, итоговый SHA/URL — в отчёте релиза.

## Ручная приёмка владельцем

1. Войти администратором, открыть `/admin/pharmacy-mirror` («База аптеки»).
2. Убедиться, что последняя связь свежая; раскрыть состояние всех 12 таблиц.
3. Найти известный товар по названию, затем отдельно по PRODUCT_ID и штрихкоду.
   Для ценника партии выбрать «Штрихкод товара / партии».
4. Открыть карточку и сравнить товар, производителя, единицу, остатки, партии и
   разрешённые исходные поля с «Алгоритмом». Отдельно подтвердить назначение цен
   и INCOME_DATE_OLD; до подтверждения UI сохраняет исходные названия.
5. Записать количество, received_at и max_change_id остатков выбранного товара.
6. После обычной реальной продажи владельцем подождать 1–2 минуты и нажать
   «Обновить данные» либо дождаться 60-секундного обновления видимой вкладки.
7. Сравнить остаток, received_at/max_change_id и последнюю связь/пакет. При отсутствии
   изменений сверить наличие изменения в «Алгоритме», не создавать тестовую продажу.
8. Открыть старый каталог/категории/заказы и убедиться, что их обычная работа сохранена.

Реальная продажа не выполнялась агентом разработки; соответствие после продажи
остаётся ручным этапом приёмки.

## Границы инфраструктурного заключения

Проверены routing/auth boundary, Lambda runtime Python 3.12/x86_64, memory 265 MB,
timeout 30 s, VPC/subnet/SG IDs, layer psycopg2:1, только имена environment,
RDS PostgreSQL 18.3/db.t3.micro/gp3 20 GB, private/Single-AZ, SSL require,
индексы и реальные планы. API Gateway accessLogSettings и methodSettings пусты.
В Lambda используется одна переиспользуемая связь с rollback/reset при ошибке.

Это не полный инфраструктурный аудит: не собраны IAM policy review, правила SG,
usage-plan throttling/request limits/CORS, полная история latency/errors/throttles,
cold starts, max_connections/current usage, RDS Proxy/topology evidence,
Performance Insights, IOPS/slow-query history, все DDL/constraints и pool-load tests.
Общий вывод о production capacity или полном AWS security posture не делается.

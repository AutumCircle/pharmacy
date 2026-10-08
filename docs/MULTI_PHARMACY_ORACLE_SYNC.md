# Две аптеки: синхронизация остатков напрямую из Oracle «Алгоритма»

> Статус: **план, не реализовано**. Документ фиксирует решения, принятые по результатам
> диагностики базы аптеки (октябрь 2026), и порядок безопасного перехода.

## 1. Что установлено

| Факт | Источник |
| --- | --- |
| Аптечная программа «Алгоритм», база Oracle Database **11g XE 11.2** (бесплатная), локально `127.0.0.1:1521/xe`, схема `ORGANIZ` | Планировщик, OraExchange, `sqlplus -v` |
| ПК аптеки: Windows 7 SP1 (6.1.7601) | `cmd` |
| Текущая выгрузка: `OraExchange.exe` → `OUT\OSTATKI.DBF` (NAME, PRICE, COUNTRY, PROIZVOD) → FTP стороннего сервиса | Вкладки «Выборка», «Основные» |
| Вторая аптека: та же программа, отдельная локальная Oracle, тот же формат выгрузки | Владелец |
| Кодировка данных: Windows-1251 | spool-файлы |

Ключевые таблицы и колонки:

| Таблица | Колонки | Назначение |
| --- | --- | --- |
| `T_PRODUCT` | `PRODUCT_ID`, `PRODUCT_NAME`, `SCAN_CODE`, `VENDOR_ID`, `COUNTRY_ID`, `PRODUCT_MNN_ID`, `PRODUCT_IN_PACK`, `IS_DEL_FLAG`, `CHANGE_ID` | Справочник товаров |
| `T_SKLAD_STATE` | `PRODUCT_ID`, `SKLAD_ID`, `INCOME_ID`, `PRODUCT_COUNT_SKLAD`, `OUTCOME_PRICE_ONE_W_NDS`, `CHANGE_ID` | Остаток **по партиям** |
| `T_VENDOR`, `T_COUNTRY`, `T_PRODUCT_MNN` | `VENDOR_NAME`, `COUNTRY_NAME`, `PRODUCT_MNN_NAME` | Справочники |

Качество данных аптеки №1 (`check3`):

| Показатель | Значение |
| --- | --- |
| Товаров в наличии (`PRODUCT_ID`) | 11 351 |
| Со штрихкодом / из них EAN-13 | 10 696 / 9 271 |
| Внутренние коды `2…` / коды маркировки DataMatrix | 24 / 85 |
| Один штрихкод у нескольких `PRODUCT_ID` | 135 |
| Остаток меньше одной продаваемой единицы («пыль» от округления) | 213 |
| Разные цены у партий одного товара | 1 584 |
| Склады с остатком | `SKLAD_ID` 81 (14 519 партий), 1 (478 партий) |
| Резерв, `GTIN`, `IS_NO_RECEPT` | не используются |
| МНН заполнен | 621 (5%) |

Найденные дефекты текущей выгрузки: `select distinct` по партиям даёт дубли с разной ценой,
а условие `> 0` выводит «пыль» как товар в наличии.

## 2. Принятая архитектура

```text
Аптека 1: Oracle XE → pharmacy agent (раз в 60 с) ─┐
                                                   ├─ HTTPS, только исходящие → API Gateway → internal Lambda → RDS
Аптека 2: Oracle XE → pharmacy agent (раз в 60 с) ─┘
```

- Сайт ищет только по RDS. Компьютеры аптек не принимают входящих подключений.
- Агент отправляет **текущее состояние изменившихся товаров** (не события продаж), раз в час — полный снимок для сверки.
- Точность в момент заказа обеспечивается проверкой заказа агентом нужной аптеки (этап 6).
- OraExchange и FTP стороннего сервиса не трогаются.
- «Живой» запрос из облака в Oracle не используется: он требует открытых портов и ломает сайт при выключенном ПК.

## 3. Изменения в базе данных (новая миграция)

Сохраняется существующая модель: `medicines` остаётся карточкой товара на сайте (название, фото,
категории, карусели), поэтому публичный API и frontend почти не меняются.

| Объект | Назначение |
| --- | --- |
| `pharmacies` | `id` (1, 2), название, адрес, `is_active`, `last_seen_at`, `last_sync_at` |
| `pharmacy_products` | Связь «товар аптеки → карточка сайта»: `pharmacy_id`, `source_product_id` (`PRODUCT_ID` из Oracle), `medicine_id`, `scan_code`, исходные название/производитель/страна, `product_in_pack`. Уникальность `(pharmacy_id, source_product_id)` |
| `pharmacy_stock` | Остаток: `pharmacy_id`, `source_product_id`, `quantity`, `price`, `price_min`, `price_max`, `lots`, `updated_at` |
| `pharmacy_sync_batches` | Журнал пакетов агента: идемпотентный ключ, порядковый номер, полный/дельта, счётчики, ошибки |
| `product_match_reviews` | Спорные сопоставления (общий штрихкод, внутренний код) для ручной проверки в админке |
| `medicines.barcode` | Нормализованный EAN-13 карточки, индекс; ключ подбора фото |

`medicines.in_stock` и `medicines.price` становятся производными: пересчитываются после каждого
пакета только для затронутых карточек (`in_stock` = есть хотя бы в одной активной аптеке).
`medicines.image_url` синхронизацией не меняется.

## 4. Сопоставление товаров двух аптек

`PRODUCT_ID` в двух базах разный, поэтому карточка сайта ищется так:

1. уже существующая связь `(pharmacy_id, source_product_id)`;
2. валидный EAN-13 (контрольная цифра, не префикс `2`), для кода маркировки — GTIN из `(01)`;
3. нормализованные «название + производитель + страна» (как сейчас);
4. иначе — новая карточка.

Конфликты (штрихкод у нескольких карточек, совпадение по названию при разных штрихкодах)
не сливаются автоматически, а попадают в `product_match_reviews`.

## 5. Изменения в backend

| Где | Изменение |
| --- | --- |
| `backend/v1/internal_sync` | Новый маршрут `POST /v1/internal/pharmacies/{pharmacy_id}/stock-batches`: дельта или полный снимок; авторизация отдельным ключом каждой аптеки; защита от резкого падения числа строк — **отдельно по аптеке**; идемпотентность по ключу пакета; `POST .../heartbeat` |
| `backend/v1/shared` | Нормализация штрихкодов (EAN-13, GTIN из DataMatrix), сопоставление, пересчёт `medicines` |
| `backend/v1/public_api` | В карточке товара — наличие по аптекам; дальше — выбор аптеки при заказе |
| `backend/v1/admin_api` + админка | Статус аптек (последняя связь), очередь сопоставлений, фильтр «без фото» по популярности |
| `backend/lambda-legacy/sync-receiver` | **Отключается после перехода**: он делает `UPDATE medicines SET in_stock = FALSE` по всему каталогу и затёр бы данные второй аптеки. Два писателя каталога одновременно не допускаются |

## 6. Новый агент аптеки

Отдельная программа (рабочий `backend/local-agent/agent.py` не заменяется до перехода).

- Python 3.8 (Windows 7), сборка PyInstaller по образцу `scripts/build_win7_agent.ps1`.
- Драйвер Oracle: `cx_Oracle` 8.3 (или `python-oracledb` в thick-режиме) с клиентскими
  библиотеками, установленными вместе с Oracle XE. Разрядность Python должна совпадать с разрядностью XE — проверить при установке.
- Подключение под отдельным пользователем `SITE_READER` с правами **только SELECT** на нужные таблицы.
- Цикл: запрос агрегированных остатков → сравнение с прошлым состоянием в локальном SQLite →
  отправка изменений; полный снимок раз в час; heartbeat; очередь при отсутствии интернета; один процесс (lock).
- `config.json` на ПК: `pharmacy_id`, DSN Oracle, пользователь и пароль `SITE_READER`, адрес API, ключ аптеки. Не коммитится.
- Планировщик заданий: триггеры «При запуске компьютера» и «Каждые 5 минут» (если агент уже работает, новый экземпляр сразу завершается), «Перезапускать при сбое».

Черновик запроса (значения порогов и правило цены — после решений из раздела 8):

```sql
SELECT p.product_id,
       TRIM(p.product_name)  AS name,
       TRIM(v.vendor_name)   AS vendor,
       TRIM(c.country_name)  AS country,
       TRIM(p.scan_code)     AS scan_code,
       p.product_in_pack,
       SUM(s.product_count_sklad)         AS quantity,
       MAX(s.outcome_price_one_w_nds)     AS price_max,
       MIN(s.outcome_price_one_w_nds)     AS price_min,
       COUNT(*)                           AS lots
FROM organiz.t_sklad_state s
JOIN organiz.t_product p ON p.product_id = s.product_id
JOIN organiz.t_vendor  v ON v.vendor_id  = p.vendor_id
JOIN organiz.t_country c ON c.country_id = p.country_id
WHERE s.product_count_sklad > 0
  AND p.is_del_flag IS NULL
  -- AND s.sklad_id IN (...)            -- после решения по складам
GROUP BY p.product_id, p.product_name, v.vendor_name, c.country_name, p.scan_code, p.product_in_pack
HAVING SUM(s.product_count_sklad) * NVL(NULLIF(p.product_in_pack, 0), 1) >= 0.999
```

Создание пользователя только для чтения (выполняет администратор под `SYSTEM`, пароль задаётся на месте):

```sql
CREATE USER site_reader IDENTIFIED BY "<пароль>";
GRANT CREATE SESSION TO site_reader;
GRANT SELECT ON organiz.t_product     TO site_reader;
GRANT SELECT ON organiz.t_sklad_state TO site_reader;
GRANT SELECT ON organiz.t_vendor      TO site_reader;
GRANT SELECT ON organiz.t_country     TO site_reader;
GRANT SELECT ON organiz.t_product_mnn TO site_reader;
```

## 7. Порядок перехода

1. Ответы на вопросы раздела 8; `check2`/`check3` во второй аптеке.
2. Миграция БД и новый internal-маршрут — сначала staging, на сайт не влияет.
3. Агент в аптеке №1 в **теневом режиме**: пишет только `pharmacy_*`, витрина продолжает работать от старой выгрузки. Несколько дней сверки.
4. Переключение аптеки №1: остановить старый `agent_sync.exe` и маршрут legacy sync-receiver, включить пересчёт `medicines`. План отката: вернуть старый агент.
5. Аптека №2: теневой режим → включение.
6. Проверка заказа агентом и выбор аптеки при оформлении.
7. Подбор фото по штрихкодам (S3 `images/products/…`, `medicines.image_url`).

## 8. Открытые вопросы владельцу

1. Что такое `SKLAD_ID = 1` и `81`; какие склады показывать на сайте.
2. Какую цену показывать при разных ценах партий (максимальная / старейшая партия / минимальная) и какую — если цены в двух аптеках разные.
3. Продажа поштучно из вскрытой упаковки или только целыми упаковками.

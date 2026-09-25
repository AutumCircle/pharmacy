# Аптека «Ватан» — контекст проекта

> Этот документ — стартовая точка для Codex, Codex Cloud, Claude Code и человека-разработчика.
> Он описывает репозиторий и подтверждённые исходниками контракты. Фактические настройки AWS,
> Vercel и секреты не хранятся в Git и должны проверяться в соответствующих консолях перед
> инфраструктурными изменениями.

## 1. Назначение

`pharmacy` — интернет-витрина и оформление заказов аптеки «Ватан». Покупатель ищет лекарства,
видит категории и карусели, добавляет товары в корзину и оформляет заказ. Администратор
управляет заказами, категориями, каруселями, баннерами, контактами, наценкой и каталогом.

Основной Git-репозиторий: `https://github.com/AutumCircle/pharmacy.git`.

`main` — единственный источник правды и ветка, из которой должен выполняться production deploy.
Незавершённые изменения никогда не вносятся напрямую в `main`: для них создаётся отдельная
ветка и Draft Pull Request.

## 2. Карта репозитория

| Путь | Назначение |
| --- | --- |
| `src/app` | Next.js App Router: публичные страницы, админ-панель и same-origin API routes. |
| `src/components` | Общие визуальные компоненты сайта. |
| `src/context` | Клиентские состояния корзины и избранного. |
| `src/lib/api-v1` | Server-only клиент API v1 и типы контрактов. |
| `backend/v1` | Python Lambda: public API, admin API, internal sync и Telegram notifier. |
| `backend/local-agent` | Текущий Windows 7 агент синхронизации, из которого собирается `agent_sync.exe`. |
| `backend/v1/local_agent` | Новый v1-прототип агента с S3 upload flow; не подменять им рабочий Win7 агент без отдельной миграции. |
| `backend/lambda-legacy` | Устаревшие Lambda handlers. Не расширять; по возможности выводить из production routing. |
| `db/migrations` | Версионируемые миграции PostgreSQL. |
| `infrastructure/aws` | IAM/S3 policy snippets; это не полный Infrastructure-as-Code. |
| `scripts` | Сборка Lambda ZIP и Windows 7 агента. |
| `tests`, `backend/tests` | Тесты frontend-contract и Python backend. |

## 3. Целевая production-архитектура

```text
Покупатель / администратор
        │ HTTPS
        ▼
Next.js на Vercel
  ├─ public UI, корзина, поиск, tracking
  ├─ admin UI
  └─ same-origin /api/* route handlers
        │ server-only API credentials
        ▼
AWS API Gateway
  ├─ public routes
  ├─ admin routes
  └─ internal routes
        │
        ▼
Python AWS Lambda
  ├─ backend.v1.public_api
  ├─ backend.v1.admin_api
  ├─ backend.v1.internal_sync
  └─ backend.v1.telegram_notifier
        │ parameterized SQL / transactions
        ▼
Amazon RDS PostgreSQL
```

Контракт: только Python Lambda подключается к PostgreSQL. Browser, Next.js и аптечный
`agent_sync.exe` не должны получать RDS credentials и не должны выполнять SQL.

Публичный browser не должен получать API Gateway API key, admin bearer token, AWS keys,
database credentials или Telegram token. Next.js вызывает API Gateway только с сервера.

Подробный HTTP-контракт: [`API_CONTRACT.md`](../API_CONTRACT.md).

## 4. Frontend и hosting

- Frontend: Next.js 16 / React 19 / TypeScript.
- Hosting: Vercel, region configured in `vercel.json` as `fra1`.
- Vercel вызывает API Gateway через server-only `API_V1_BASE_URL` и `API_KEY`.
- Public catalogue reads use short revalidation; checkout, admin mutations and tracking use fresh responses.
- `src/proxy.ts` защищает `/admin/*` и `/staff/*` session cookie, но Lambda/API Gateway
  обязан повторно проверять права. UI protection alone is insufficient.

Проверяемые Vercel variables (names only):

- `API_V1_BASE_URL`, `API_KEY`, `ADMIN_API_BEARER_TOKEN`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`
- `STAFF_USERNAME`, `STAFF_PASSWORD` when staff access is enabled

Файл `.env.local` локальный и никогда не коммитится.

## 5. Orders and Telegram

1. Browser sends a checkout request to Next.js `/api/checkout` containing only customer data,
   `medicine_id` and quantity.
2. Public Lambda reads authoritative prices and stock from RDS, calculates the selling price and
   creates the order transactionally. Client-provided price, total, status and role are untrusted.
3. Next.js receives a safe notification payload and calls the protected internal notifier route.
4. Telegram notifier sends three messages: owner, pharmacy assembly and delivery.
5. Failure of the Telegram call is logged but must not erase an already-created order.

Telegram notifier variables are configured only in AWS, never in Git:

- `NOTIFIER_BEARER_TOKEN`, `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OWNER_CHAT_ID`, `TELEGRAM_PHARMACY_CHAT_ID`, `TELEGRAM_DELIVERY_CHAT_ID`
- optional `TELEGRAM_CHAT_ID` fallback and `ADMIN_ORDER_BASE_URL`

## 6. Pharmacy PC catalogue sync

The pharmacy PC produces `OSTATKI.DBF`. The currently deployed/operational compatibility agent
is `backend/local-agent/agent.py`, packaged by `scripts/build_win7_agent.ps1` as `agent_sync.exe`.

- It **must be built with Python 3.8** because the pharmacy computer runs Windows 7.
- The build script creates an isolated Python 3.8 venv, verifies `3.8.*`, and uses PyInstaller.
- The agent watches and polls `OSTATKI.DBF`, waits for a stable file, checks DBF header/record
  consistency, creates a full snapshot, and queues it in local SQLite.
- It sends gzip JSON to the configured `/api/sync` endpoint and sends a heartbeat to `/api/heartbeat`.
- It has a single-process lock, an SQLite queue, retry behavior for transient failures, and
  quarantines a snapshot rejected with `SUSPICIOUS_SNAPSHOT_DROP`.
- Its real machine configuration is local `config.json`; it contains endpoint/API key and must
  not be committed.

The v1 design in `backend/v1/local_agent` uploads a compressed snapshot through an internal API
and S3. Treat it as a separate migration project; do not replace the running agent or enable two
catalogue writers at once.

## 7. Database and operational safety

- Database: PostgreSQL in Amazon RDS.
- Schema changes are SQL migrations under `db/migrations`; apply once, in numerical order, after
  backup and staging validation.
- Money uses server-side decimal arithmetic; do not use JavaScript floating point as authority.
- Catalogue imports are complete snapshots. A suspicious sudden row-count drop is intentionally
  rejected to avoid marking most of the catalogue unavailable because the DBF was being written.
- Before changing an import threshold, investigate the DBF row count and source file stability.
- Dangerous legacy actions (`wipe_db`, bulk order deletion, archive cleanup) must never be exposed
  by production routes.

Actual RDS class, endpoint, network, API Gateway routes, deployed Lambda versions and runtime
variables are not inferable from this repository. Verify them in AWS before any deployment or
migration.

## 8. Development rules for Codex and Claude Code

1. Read `AGENTS.md`, this file, `API_CONTRACT.md` and the relevant feature code before editing.
2. Never commit secrets, `.env*`, local agent state, build artifacts or `output/`.
3. Do not directly modify production data during diagnostics. Do not run destructive scripts.
4. Keep the boundary `Next.js -> API Gateway -> Lambda -> RDS`; no direct RDS/Prisma from Next.js.
5. Create one branch per outcome: `codex/<feature>`, `claude/<feature>` or `fix/<issue>`.
6. Commit progress regularly. For unfinished work, push the branch and open a Draft PR.
7. Before merging, review the diff and run the relevant checks. Minimum frontend checks are
   `npm run lint` and `npm run build`; do not claim a check passed unless it was actually run.
8. Merge to `main` only after approval. Vercel production deploy must follow `main`.

## 9. Cloud versus local work

- Local Codex/Claude Code: works with a cloned repository on a specific PC and can run the local
  dev server. Local-only files and secrets remain on that PC.
- Codex Cloud: checks out a GitHub branch in an isolated remote environment. It sees committed
  repository files and configured cloud secrets, not an arbitrary local `.env.local` or unpushed work.
- For concurrent work use separate branches/worktrees. Do not let two agents write to the same
  branch at the same time.

## 10. Required human checks before a production change

- Confirm the target Git branch and Vercel deployment URL.
- Confirm affected Lambda handler/package and whether it is actually deployed.
- Confirm migration state and take an RDS snapshot before schema/data migration.
- Confirm AWS secret variable **names and presence**, never paste their values into an issue/chat/commit.
- For sync changes, confirm the Windows 7/Python 3.8 build and test against a safe DBF copy.

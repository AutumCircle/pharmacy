# Аптека «Ватан»

Интернет-витрина и система заказов аптеки «Ватан».

## С чего начать

Перед любой работой прочитайте:

1. [`AGENTS.md`](AGENTS.md) — обязательные правила разработки и безопасности.
2. [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) — архитектура, hosting, RDS, Lambda,
   Telegram и Windows 7 sync agent.
3. [`API_CONTRACT.md`](API_CONTRACT.md) — HTTP-контракты и границы доверия.

## Локальный frontend

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Заполните `.env.local` настоящими значениями только на своей машине. Никогда не добавляйте
секреты в Git.

Проверки:

```powershell
npm run lint
npm run build
```

## Git workflow

- `main` — production-ready ветка и источник Vercel production deploy.
- Для каждой задачи создавайте отдельную ветку: `codex/<feature>`, `claude/<feature>` или `fix/<issue>`.
- Незавершённая задача: commit + push + Draft Pull Request.
- Не работайте двум агентам в одной ветке одновременно.

## Production data path

```text
Next.js (Vercel) -> API Gateway -> Python Lambda -> RDS PostgreSQL
```

Только Lambda имеет доступ к PostgreSQL. Подробнее — в
[`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md).

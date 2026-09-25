# Pharmacy Vatan V4 — Claude Code instructions

Read [`AGENTS.md`](AGENTS.md) and [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) first.
They are the repository's canonical operating rules and architecture context.

Additional requirements for Claude Code:

- Work only on a dedicated Git branch; never commit directly to `main`.
- Do not commit `.env*`, credentials, `output/`, local agent databases/logs or generated build files.
- Preserve the production boundary: Next.js -> API Gateway -> Python Lambda -> RDS PostgreSQL.
- Do not add direct database access from Next.js or browser code.
- Treat `backend/local-agent/agent.py` as the working Windows 7 compatibility agent. It is built
  using Python 3.8 by `scripts/build_win7_agent.ps1`; do not replace it with the v1 agent casually.
- Do not deploy, run destructive migrations, delete orders, reset catalogues or modify live AWS
  resources unless the user explicitly asks.
- Run only relevant non-destructive validation and report exactly what was run.
- Keep documentation updated when the architecture, deployment process or agent protocol changes.

# Pharmacy Vatan V4 — agent guide

## Scope

These instructions apply to the entire repository.

## Project contract

- This is the main Pharmacy Vatan V4 project.
- The intended production data path is `Next.js -> API Gateway -> Python Lambda -> RDS PostgreSQL`.
- Keep the database boundary in Python Lambda. Do not introduce Prisma or direct RDS access from Next.js unless the project owner explicitly changes this decision.
- Treat the current `README.md` as create-next-app boilerplate, not as an authoritative architecture document.
- Prefer communication and audit reports in Russian unless asked otherwise.

## Working rules

- Start unfamiliar work with a read-only audit of repository structure, architecture, security, and performance.
- Do not change application code, infrastructure, dependencies, or configuration during an audit unless explicitly asked.
- Preserve user changes and keep edits narrowly scoped.
- Never execute destructive or state-changing diagnostic scripts. In particular, do not run `wipe-db.py`, cleanup actions, order deletion, or other mutation endpoints during verification.
- Never print, commit, or hard-code credentials. Report secret findings by file and variable name only, and recommend rotation if a secret is exposed.
- Do not expose `API_KEY`, database credentials, or admin credentials through `NEXT_PUBLIC_*` variables or browser bundles.
- Use `rg`/`rg --files` for discovery. Use `npm run lint` and `npm run build` as read-only quality gates; do not use auto-fix flags during an audit.

## Repository map

- `src/app`: Next.js App Router pages, route handlers, and server actions.
- `src/components`: shared UI components.
- `src/context`: client-side cart and favourites state.
- `src/lib/api.ts`: server-side client for API Gateway/Lambda.
- `src/middleware.ts`: admin-route access control.
- `test-*.js`, `test-*.py`: ad hoc remote diagnostics; inspect before use because they may contact live AWS resources.

## Architecture boundaries

- Browser code should call same-origin Next.js routes where a server-side proxy is needed; it must not receive AWS API keys.
- Next.js server components, route handlers, and server actions may call API Gateway with server-only credentials.
- Only Lambda may issue SQL to RDS. Keep SQL parameterized and validate/sanitize action payloads at the Lambda boundary.
- Keep public and admin operations separated and enforce authorization in the handler/action itself, not only in UI or middleware.
- Never trust client-supplied prices, totals, roles, order status, or inventory state; authoritative values must be recalculated in Lambda from RDS data.
- Use one canonical API base URL from validated server configuration. Fail fast when required environment variables are missing.

## Reliability and performance expectations

- Set explicit upstream timeouts and cancellation for Gateway calls.
- Retry only safe/idempotent reads by default; use bounded exponential backoff with jitter. Do not blindly retry mutations.
- Check HTTP status and response shape before consuming JSON.
- Make caching intentional per operation: short-lived caching may be used for stable catalogue reads, while admin reads and mutations require fresh data and explicit invalidation.
- Avoid fetching entire tables to filter or count in Next.js. Push filtering, sorting, pagination, aggregation, and projections into parameterized SQL in Lambda.
- Parallelize independent upstream reads and avoid request waterfalls.
- Keep list endpoints paginated with explicit limits and deterministic ordering.

## Audit evidence required for final infrastructure conclusions

- API Gateway: API type, region/stage, routes/methods, integrations, auth/API-key and usage-plan settings, throttling, request limits, CORS, access logs, and latency/error metrics.
- Lambda: runtime/architecture, deployed handler and dependency versions, memory, timeout, reserved/provisioned concurrency, VPC/subnets/security groups, environment-variable names, layers, IAM role/policies, CloudWatch logs/metrics, cold starts, and error/throttle history.
- RDS: engine/version/class, topology and Multi-AZ, endpoint path via RDS Proxy or direct connection, connection limits/current usage, SSL settings, security groups/subnets, storage/IOPS, Performance Insights, slow-query evidence, schema/DDL, indexes, constraints, table statistics, representative `EXPLAIN (ANALYZE, BUFFERS)` plans, and Lambda connection-pool lifecycle.

## Completion checks

- Summarize findings by severity and cite exact files/lines.
- Distinguish verified facts from hypotheses and list missing AWS/Lambda/SQL evidence.
- Confirm `npm run lint` and `npm run build` results separately.
- If an audit was requested, stop after the report and proposed remediation order; do not implement fixes without approval.

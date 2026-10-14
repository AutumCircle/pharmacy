---
name: builder
description: Factory stage 2. Implements spec.md on the job's feature branch, tests it, commits, and writes build.md. Resumed for each review round.
tools: Read, Grep, Glob, Bash, Edit, Write
model: opus
---
You build one factory job. You are spawned once as `builder-<job-id>` and resumed for every
later round, so keep your own notes in `build.md`, not in your head.

**Where you work:** the orchestrator has created a git worktree at `.factory-worktrees/<job-id>`
on branch `factory/<job-id>` (branched from `main`). Edit and commit **only there**. Never
touch `main`, never push, never deploy.

**Read first:** `factory/jobs/<job-id>/spec.md`, `AGENTS.md`, `docs/PROJECT_CONTEXT.md`.
On a later round, read every `review-*.md` in the round folder you are pointed at (and any
`rework-*.md` note) and fix each `CHANGES` item. Address findings; don't rewrite unrelated code.

**Repo conventions**
- TypeScript in `src/` (App Router, `@/*` → `src/*`), Tailwind 4, Russian UI copy.
- Python Lambda code in `backend/v1`; parameterized SQL only; validate at the Lambda boundary.
- Only Lambda talks to RDS. No Prisma, no DB access from Next.js or the browser.
- No secrets, no `.env*`, no `NEXT_PUBLIC_*` credentials. Never trust client prices/totals/roles.
- New migrations: next number in `db/migrations/NNNN_name.sql`; write it, never run it.
- Do not modify `backend/local-agent/agent.py` (Windows 7 / Python 3.8 agent) unless the spec says so.
- Never run `test-*.js` / `test-*.py` diagnostics, `wipe-db.py`, or anything that calls live AWS.

**Test against the acceptance criteria** (run from the worktree):
- Frontend: `npm run test:frontend`. New `tests/*.test.ts` files must be added to that script
  in `package.json`. Tests use `node:test` + `node:assert/strict` and import `../src/lib/*.ts`.
- Backend: `python3 -m unittest discover -s backend/tests -t .` (needs `pip install psycopg2-binary boto3`).
  Two tests already fail on `main` (`test_banner_title_can_be_empty_for_image_only_banner`,
  `test_quantity_on_delivered_order_recalculates_total_and_audits`); don't count those against
  the job, but don't add new failures.
- If `node_modules` is missing in the worktree: `ln -s ../../node_modules node_modules`
  (or `npm ci`), then run `npm run lint` and, when the change touches `src/`, `npm run build`.

**Commit** on `factory/<job-id>` with a clear message, one or more commits per round.

**Write `factory/jobs/<job-id>/build.md`** (in the main checkout, not the worktree). Append a
section per round:

```markdown
## Round <n>
- Commits: <short sha> <message>
- Changed: <files>
- Acceptance criteria: 1 ✅ … 2 ✅ … (how each was verified)
- Tests run: <exact commands> → <result>
- Review findings addressed: <finding → fix>   (round 2+)
- Open questions / not done: …
```

---
name: factory
description: Run the software factory. /factory <feature> | next | approve <job-id> | rework <job-id> <note>. The session that runs it is the orchestrator — it spawns every agent and is the only writer of factory/board.json.
argument-hint: <feature> | next | approve <job-id> | rework <job-id> <note>
---
# /factory — orchestrator

You are the orchestrator. You run the loop, spawn the agents in `.claude/agents/`, and you
are the **only** writer of `factory/board.json`. You never write code, specs, reviews or
decisions yourself; agents get their context from files and write only their own file.

Arguments: `$ARGUMENTS`

## The loop

```
feature → spec-writer → builder ◄──────────────┐
                           │                    │ any CHANGES: resume builder
          ┌────────┬───────┴───────┬────────┐   │ (max 2 fix rounds)
       security    ux          ui design   code │
          └────────┴───────┬───────┴────────┘   │
                     WAIT FOR ALL 4 ────────────┘
                           │ all PASS (or fix rounds used up)
                        approver
                 APPROVE │      │ ESCALATE
             merge to main      needs-human ◄── /factory approve
```

Tunables: `MAX_FIX_ROUNDS = 2`. Reviewers: `security`, `ux`, `ui`, `code`
(agents `review-<name>`, files `review-<name>.md`).

## Files

```
factory/board.json                      state; you write it after every change
factory/backlog.md                      queue for /factory next
factory/jobs/<job-id>/spec.md           spec-writer
factory/jobs/<job-id>/build.md          builder (one section per round)
factory/jobs/<job-id>/round-<n>/review-<name>.md   one per reviewer
factory/jobs/<job-id>/rework-<k>.md     human note from /factory rework (you write it verbatim)
factory/jobs/<job-id>/decision.md       approver
.factory-worktrees/<job-id>/            git worktree on branch factory/<job-id> (gitignored)
```

Board job shape (keep every field; `reviews` is the current round, `history` the finished ones):

```json
{ "id": "003-rate-limiting", "title": "Rate limiting on tracking", "branch": "factory/003-rate-limiting",
  "stage": "review", "round": 2,
  "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "pending", "code": "PASS" },
  "history": [ { "round": 1, "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "PASS", "code": "CHANGES" } } ],
  "decision": null, "reworks": 0, "note": "", "updated": "2026-10-14T10:00:00Z" }
```

`stage` is one of `spec`, `build`, `review`, `approve`, `needs-human`, `merged`.
Update `updated` (UTC ISO) on every write. Read the file, change one job, write it back.

## /factory <feature>

1. **Job id**: next 3-digit number after the highest in `board.json` and `factory/jobs/`, plus a
   short ASCII kebab slug (≤ 4 words), e.g. `004-tracking-rate-limit`. Create `factory/jobs/<id>/`.
   Add the job to the board with `stage: "spec"`, `round: 0`, all reviews `pending`.
2. **Spec**: spawn `spec-writer` with the job id and the feature text. When it returns, confirm
   `spec.md` exists.
3. **Worktree**: `git fetch origin main:main` (ignore a non-fast-forward refusal), then
   `git worktree add -b factory/<id> .factory-worktrees/<id> main`.
4. **Build**: set `stage: "build"`, `round: 1`. Spawn agent `builder` **named `builder-<id>`** with:
   job id, worktree path, "round 1: implement spec.md". Wait for it; confirm `build.md` exists.
5. **Review round n**: set `stage: "review"`, reset `reviews` to `pending`, create
   `factory/jobs/<id>/round-<n>/`. Spawn the four reviewers **in one message, in the background**,
   each told the job id and its round folder.
   As each finishes, read the first line of its file and set its chip (`PASS`/`CHANGES`) on the board.
6. **WAIT FOR ALL**: the round is done only when all four `review-*.md` files exist in
   `round-<n>/`. Never resume the builder mid-round. If an agent finished without writing its
   file, or the first line isn't `VERDICT: PASS|CHANGES`, re-run that one reviewer once; if it
   still fails, record `CHANGES`.
7. **Route**: push `{round, reviews}` onto `history`.
   - All `PASS` → step 8.
   - Any `CHANGES` and fewer than `MAX_FIX_ROUNDS` builder resumes in this run → set
     `stage: "build"`, `round: n+1`, and **resume the same builder** with
     `SendMessage` to `builder-<id>`: "Round n reviews are in `factory/jobs/<id>/round-<n>/`.
     Fix every CHANGES item, commit on factory/<id>, append Round n+1 to build.md."
     (If `builder-<id>` no longer exists — e.g. a new session — spawn a fresh `builder` with that
     name and the same message; it recovers from the files.) Then go to step 5.
   - Any `CHANGES` with fix rounds used up → step 8; the approver will escalate.
8. **Approve**: set `stage: "approve"`. Spawn `approver` with the job id. Read the first line of
   `decision.md` into `decision`.
   - `APPROVE` → **merge** (below), `stage: "merged"`.
   - `ESCALATE` → `stage: "needs-human"`, `note` = one line from decision.md.
9. Tell the user the outcome in 2–3 lines and where to look.

**Merge to main** (local only — pushing `main` deploys production on Vercel, so never push):
find the worktree that has `main` checked out (`git worktree list`). If there is one, run
`git merge --no-ff factory/<id> -m "factory: merge <id>"` there; otherwise run
`git -C .factory-worktrees/<id> switch main` and merge there. Then
`git worktree remove .factory-worktrees/<id>` (keep the branch). On a merge conflict, abort
the merge and set `stage: "needs-human"` with the note `merge conflict`. Afterwards tell the user
`main` is ahead of `origin/main` and that pushing it (or opening a PR) is their call.

## /factory next

Take the first `- [ ]` line in `factory/backlog.md`, run it as `/factory <that text>`, and when
the job is created change the line to `- [x] <text> → <job-id>`. If nothing is unchecked, say so.

## /factory approve <job-id>

Only for a job in `needs-human`. Show the user the first lines of `decision.md` and confirm
they want it merged; then **merge to main** as above, set `stage: "merged"`, `note: "approved by human"`.

## /factory rework <job-id> <note>

For any job that is not `merged`. Increment `reworks` to k and write the note verbatim to
`factory/jobs/<id>/rework-<k>.md`. Recreate the worktree if it was removed
(`git worktree add .factory-worktrees/<id> factory/<id>`). Set `stage: "build"`,
`round: round+1`, `decision: null`, and resume `builder-<id>` (or spawn it fresh) with:
"Human rework note in `factory/jobs/<id>/rework-<k>.md`. Address it, commit, append to build.md."
Then continue from step 5 with a fresh `MAX_FIX_ROUNDS` budget.

## Rules

- Agents read files, not this conversation; pass them only the job id, paths and round number.
- Each agent writes only its own file. You write only `board.json`, `backlog.md` checkmarks and rework notes.
- The builder commits only on `factory/<id>` in its worktree. Nobody pushes. Nobody deploys.
- If any agent errors out, set `stage: "needs-human"` with a one-line `note` and stop.

## Dashboard

`cd factory && python3 -m http.server 8000`, then open `http://localhost:8000/dashboard.html`.
It polls `board.json`; `dashboard.html?demo` shows sample data.

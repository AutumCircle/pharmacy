VERDICT: PASS

Commands (in .factory-worktrees/009-ios-carousels-endpoint):
- npm run test:frontend: 88 pass / 0 fail
- npm run lint: clean
- python3 -m unittest discover -s backend/tests -t .: 274 tests, 1 failure + 1 error (the two known main failures; no backend changes in the diff)
- git diff --stat main...HEAD: only API_CONTRACT.md, package.json, route.ts, public-carousels.ts, tests/public-carousels.test.ts. Nothing under backend/, db/, proxy.ts or page.tsx.

Findings: none blocking.
- Criteria 1-7 are met and covered by tests or source checks. The route exports only GET and dynamic. Its catch returns the fixed 503 body with no-store and Retry-After. The mapper whitelists fields, preserves order and omits empty carousels. The new test is in test:frontend.
- npm run build was not rerun by me. It was reported OK in build.md.

Notes:
- public-carousels.ts: the mapper accepts null/undefined and defends against a non-array products value, which is slightly more than the spec requires. It is harmless.
- The route is not deployed. Merging to main and a Vercel deploy are needed for production.

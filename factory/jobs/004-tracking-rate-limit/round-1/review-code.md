VERDICT: PASS

Commands (in .factory-worktrees/004-tracking-rate-limit):
- npm run test:frontend -> 56 pass, 0 fail (new file is listed in package.json)
- npm run lint -> clean
- python3 -m unittest discover -s backend/tests -t . -> 248 run, 1 failure + 1 error (the two known main failures; no backend change in diff)

Criteria 1-3, 6, 7 are covered by unit tests and the doc diff. Criterion 4 is met by code review: the limiter runs after phone validation and before trackPublicOrders, with a 429, Retry-After and the exact body. Criterion 5 is met by code review: PublicReadError is thrown, and the page shows serverMessage only for 429. A failed read is removed from the dedupe cache, so a retry is not stuck.

Notes (non-blocking):
- src/lib/rate-limit.ts: the `limit <= 0` branch is unneeded for the current constants.
- The page now renders the error in the order-list view. The builder explained why this was necessary, and it is in scope for criterion 5.
- The 429 UI was not clicked through in a browser.

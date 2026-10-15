VERDICT: PASS

## Commands run (worktree .factory-worktrees/005-checkout-rate-limit)
- `npm run test:frontend` -> 58 pass, 0 fail (includes tests/checkout-rate-limit.test.ts)
- `npm run lint` -> clean
- `python3 -m unittest discover -s backend/tests -t .` -> 253 run, 1 failure + 1 error (the two known main failures; backend unchanged)
- `grep -rn rate-limit src tests` -> only checkout route and the new test import the module
- `git diff main --stat -- src/app/api/tracking src/app/tracking src/lib/api-v1/client-reads.ts` -> empty
- Did not rerun `npm run build` (builder reports success; no type-risky changes).

## Findings
No blocking findings.
- Limiter runs after Idempotency-Key and shape checks (400s use no quota) and before cookies()/createPublicOrder. Limit 5 >= 3. Response 429 + Retry-After + exact body match spec.
- Cart: RATE_LIMITED copy added; 429 goes through existing non-OK branch (no clearCart/form reset/sessionStorage removal).
- src/lib/rate-limit.ts is pure; test uses injected `now` only and covers criteria 1-3.
- API_CONTRACT.md documents values, per-instance scope, 429, remaining gap, tracking not limited. package.json lists the new test.

## Notes
- Criterion 5 verified by code review only (no browser walkthrough); acceptable per spec.
- Per-instance limiter is not a global guarantee (accepted in spec).

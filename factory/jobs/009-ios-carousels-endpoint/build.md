## Round 1
- Commits: 621f437 feat(api): public GET /api/product-carousels JSON for iOS
- Changed: src/lib/public-carousels.ts (new pure whitelist mapper), src/app/api/product-carousels/route.ts (new GET route), tests/public-carousels.test.ts (new), package.json (test added to test:frontend), API_CONTRACT.md (route-list line + new §5.4)
- Acceptance criteria:
  1 ✅ mapper copies only whitelisted keys in upstream order. Tests check exact key sets with Object.keys, that price/country/vendor/catalog_updated_at/base_price/profit/is_active/future fields are dropped, and that order is preserved.
  2 ✅ empty carousels are omitted, and [] or all-empty input gives { carousels: [] } (unit tests).
  3 ✅ the route exports only GET and dynamic='force-dynamic' and calls getPublicProductCarousels(). Verified with source tests and at runtime: `next start` against a local mock upstream on localhost:4555 returned 200, the Cache-Control header from the spec, application/json, and a whitelisted body with the empty carousel dropped.
  4 ✅ 503 + no-store + Retry-After: 30 + the exact CAROUSELS_UNAVAILABLE body. Verified by source tests and at runtime: `next start` with no env returned 503 with exactly that body. There are no apiRouteError/error.message/process.env references.
  5 ✅ no API_KEY/x-api-key/NEXT_PUBLIC_/Access-Control-Allow-Origin in the route or mapper. The src/proxy.ts matcher is unchanged and asserted by a test.
  6 ✅ API_CONTRACT.md §5.4: purpose, field table and types, empty-list case, 503 shape, caching, no CORS, no rate limit, price-type note, sample JSON.
  7 ✅ test:frontend 79/79, lint clean, build OK (route listed as ƒ /api/product-carousels). `git diff --stat main...HEAD` touches only the 5 files above: nothing under backend/, db/, src/proxy.ts or src/app/page.tsx.
- Tests run (in worktree, after `npm ci`): `npm run test:frontend` → 79 pass / 0 fail; `npm run lint` → clean; `npm run build` → success. The sitemap logs "API v1 server configuration is incomplete" during build because there is no env; that already happens on main. Backend tests were not run because there are no backend changes.
- Merge note: main moved on after the branch point (job 008 merged). `git merge-tree` shows one trivial conflict in package.json `test:frontend`. Keep both `tests/pharmacy-order.test.ts` and `tests/public-carousels.test.ts`.
- Open questions / not done: not deployed. The route is NOT live on production until it is merged to main and deployed to Vercel production. Target URL: https://www.aptekavatan.tj/api/product-carousels

## Round 1b — merge main
- Commits: 132ac36 Merge branch 'main' into factory/009-ios-carousels-endpoint
- Conflict: package.json `test:frontend`. Resolved by keeping both `tests/pharmacy-order.test.ts` (job 008) and `tests/public-carousels.test.ts`. The JSON was checked to parse.
- Tests run (worktree): `npm run test:frontend` → 88 pass / 0 fail; `npm run lint` → clean; `npm run build` → success (ƒ /api/product-carousels).
- `git diff --stat main...HEAD`: same 5 files as round 1, nothing else.
- Not pushed, not deployed.

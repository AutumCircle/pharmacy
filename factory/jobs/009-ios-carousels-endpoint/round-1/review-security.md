VERDICT: PASS

Security review: job 009-ios-carousels-endpoint, round 1 (diff `main...factory/009-ios-carousels-endpoint`, 5 files).

## Findings
None blocking.

- Boundary: `src/app/api/product-carousels/route.ts` only calls the existing `getPublicProductCarousels()` (`src/lib/api-v1/server.ts:175`). It has no SQL or DB client in Next.js, and there are no `backend/`, `db/`, `src/proxy.ts` or `page.tsx` changes.
- Secrets: the diff has no credentials, tokens, `.env*` files or API Gateway hostnames. `API_KEY` appears only in docs prose and in negative test assertions. There are no `NEXT_PUBLIC_*` additions, and the route is a server route handler, not a client component.
- AuthZ: the route is anonymous by design and read-only (GET only). It exposes only the fields the homepage already renders. The `src/proxy.ts:24` matcher is unchanged (`/admin`, `/staff`).
- Data exposure: `src/lib/public-carousels.ts:31-50` is an explicit whitelist that builds new objects, so `price` (base), profit, `is_active`, vendor, country and future upstream fields cannot leak. `currency` is hardcoded.
- Error handling: `route.ts:18-22` uses a bare `catch` and returns a fixed 503 body with `no-store`. It does not echo the upstream status, message, stack or env values.
- Abuse: there is no user input, no query params, no redirect, no outbound URL built from the request (no SSRF), and no HTML rendering (no XSS). The upstream query is the existing bounded carousel endpoint. No CORS header is added. No destructive endpoints.

## Notes
- The route has no rate limit, as the spec accepts. Load is absorbed by `s-maxage=60` / `stale-while-revalidate=300` at the CDN plus the 60 s fetch data cache. Note that a 503 is `no-store`, so during an upstream outage every request goes through to the function and upstream. That is acceptable at current scale. If abuse is observed, consider a short `s-maxage` (e.g. 10 s) on the 503 as well.
- `image_url` is passed through as-is from Lambda. iOS should treat it as untrusted data, i.e. load it only over https.

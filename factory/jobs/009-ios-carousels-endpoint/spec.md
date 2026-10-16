# 009-ios-carousels-endpoint: Public JSON endpoint for homepage product carousels (iOS)

## Owner request (verbatim)

В проекте Pharmacy Vatan V4 сделай безопасный публичный JSON-адрес, чтобы iOS-приложение показывало те же товарные карусели, что главная страница сайта.
Сейчас сайт получает их через getPublicProductCarousels() из src/lib/api-v1/server.ts: Next.js сервер обращается к GET /v1/public/product-carousels в API Gateway с секретным API_KEY. Не передавай этот ключ в iOS-приложение и не делай его NEXT_PUBLIC_*.
Добавь узкий GET-маршрут https://www.aptekavatan.tj/api/product-carousels в Next.js. Он должен на сервере вызвать существующий getPublicProductCarousels() и вернуть JSON с активными каруселями в существующем порядке: slug, title, sort_order, products (ID, название, цена, валюта, наличие, image_url и порядок товара). Сохрани текущую архитектуру Next.js → API Gateway → Python Lambda → RDS; не обращайся к базе из Next.js и не меняй Lambda.
Предусмотри понятный ответ при ошибке API, короткое кеширование как у главной страницы и проверку пустого списка. iOS будет делать обычный HTTPS GET через URLSession; логин Vercel, AWS-доступ и API-ключ ему не нужны. Проверь JSON-формат, npm run lint и npm run build. Сначала проверь git status и не затрагивай несвязанные изменения. После готовности дай мне рабочий URL и короткий пример ответа для iOS-разработчика; сообщи отдельно, опубликован ли маршрут на production

## Goal
The iOS app needs the same product carousels as the homepage, but the only source today is
`getPublicProductCarousels()` (`src/lib/api-v1/server.ts`), which calls API Gateway with the
server-only `API_KEY`. Add an anonymous, read-only Next.js route `GET /api/product-carousels`
that calls this existing function on the server and returns a narrow, whitelisted JSON
projection. iOS then does a plain HTTPS GET with URLSession, needing no key, login or AWS access.
The data path stays Next.js -> API Gateway -> Python Lambda -> RDS.

## Scope
- New pure mapper `src/lib/public-carousels.ts` (no `server-only`/`next` imports; only
  `import type` from `src/lib/api-v1/types.ts`), exporting
  `toPublicCarouselsPayload(carousels: ProductCarousel[]): { carousels: PublicCarouselDto[] }`.
  It copies only these fields, in upstream order (Lambda already sorts by
  `pc.sort_order, pc.id` and items by `pci.sort_order, pci.id`; do not re-sort):
  - carousel: `slug` (string), `title` (string), `sort_order` (integer), `products` (array)
  - product: `medicine_id` (integer), `medicine_name` (string), `selling_unit_price`
    (integer number, TJS, the same value the site shows; Lambda's `_medicine_response` casts it
    with `int()`, so it is a JSON number and not a decimal string), `currency` (`"TJS"`), `in_stock`
    (boolean), `image_url` (string or null), `sort_order` (integer).
  - Drops `country`, `vendor`, `catalog_updated_at`, `request_id` and any unknown or future
    upstream fields. Base price (`price`), profit, `is_active`, and internal IDs never appear.
  - Omits carousels with zero products, matching the homepage (`ProductCarousel.tsx` returns
    `null` when `products.length === 0`). If no carousels remain, the result is `{ "carousels": [] }`.
- New route `src/app/api/product-carousels/route.ts`, `GET` only:
  - `export const dynamic = 'force-dynamic'` so the build does not prerender it with live data.
    Caching mirrors the homepage: `getPublicProductCarousels()` already uses the fetch data cache
    with `cacheSeconds: 60` (`next: { revalidate: 60 }`). The homepage has no route-level
    `revalidate` export. On success, also send
    `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
  - Success: HTTP 200, body `{ "carousels": [...] }`, `Content-Type: application/json`.
  - Any thrown error (`ApiV1Error` of any status, including `API_CONFIGURATION_ERROR`, timeout,
    unreachable or invalid upstream, or an unexpected error): HTTP **503**,
    `Cache-Control: no-store`, `Retry-After: 30`, body
    `{ "error": { "code": "CAROUSELS_UNAVAILABLE", "message": "Секции товаров временно недоступны." } }`.
    Do **not** use `apiRouteError`, because it forwards upstream status, codes and English config
    messages. Never include upstream messages, details, stack traces or env values.
  - No homepage-style legacy fallback to `getPublicFeaturedProducts()`. Keep the route narrow.
- `API_CONTRACT.md`: add a subsection (near §5 public read contracts or the carousel list at the
  top) that documents `GET /api/product-carousels` with its purpose (iOS/public, no auth), its
  field table and types, the empty-list case, the 503 error shape, caching, and the absence of
  CORS and rate limiting.
- `package.json`: add the new test file to `test:frontend`.
- Out of scope: `backend/v1/**` (no Lambda changes), `db/migrations/**`,
  `backend/local-agent/agent.py`, `src/proxy.ts`, `next.config.ts`, `vercel.json`, the homepage
  (`src/app/page.tsx`), `server.ts` and `types.ts` (no changes needed), and env vars. No
  `NEXT_PUBLIC_*` additions. Do not add CORS headers: native URLSession does not need them, and
  `next.config.ts` and `vercel.json` set none. Leave the unrelated uncommitted files
  (`factory/backlog.md`, `factory/board.json`, `factory/jobs/008-*`, `factory/requests/*`) alone.

## Acceptance criteria
1. `toPublicCarouselsPayload` returns exactly the whitelisted keys listed above, in the
   order received. A product carrying extra fields (`price`, `country`, `vendor`,
   `catalog_updated_at`, `base_price`, `profit`) comes out without them.
2. Carousels with empty `products` are omitted. An empty input or an all-empty input yields
   `{ carousels: [] }` (an array, never `null`).
3. `GET /api/product-carousels` returns 200 with `{ "carousels": [...] }` and
   `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. The route source exports
   only `GET` and `dynamic = 'force-dynamic'`, and it calls `getPublicProductCarousels`.
4. When the upstream call throws, the route returns 503 with
   `Cache-Control: no-store` and the exact error body above. The route source does not reference
   `apiRouteError`, `error.message`, or `process.env`.
5. No `API_KEY`, `x-api-key`, or `NEXT_PUBLIC_` string appears in the new route or mapper. The
   `src/proxy.ts` matcher stays `['/admin/:path*', '/staff/:path*']`, so the route is
   anonymous, and no `Access-Control-Allow-Origin` header is added.
6. `API_CONTRACT.md` documents the route, its fields and types, the error shape and the caching.
7. `npm run test:frontend`, `npm run lint` and `npm run build` pass. `git diff --stat` shows no
   changes under `backend/`, `db/`, `src/proxy.ts` or `src/app/page.tsx`.

## Tests
- Add `tests/public-carousels.test.ts` (`node --test`, importing `../src/lib/public-carousels.ts`).
  It asserts criteria 1–2 with fixture carousels, including key-set equality via
  `Object.keys`, order preservation, `image_url: null` passthrough, integer price, and
  `currency === 'TJS'`.
- In the same file, run source checks with `readFileSync` (same style as
  `tests/public-content.test.ts`) on `src/app/api/product-carousels/route.ts` for criteria 3–5:
  `getPublicProductCarousels`, `force-dynamic`, `s-maxage=60`, `status: 503`, `no-store`,
  `CAROUSELS_UNAVAILABLE`, and the Russian message. They also check for the absence of
  `apiRouteError`, `NEXT_PUBLIC_`, `x-api-key` and `Access-Control-Allow-Origin`. A further check
  reads `src/proxy.ts` and confirms the matcher does not include `/api`.
- No backend tests change.

## Risks
- **Security:** the route is public and unauthenticated by design. It exposes no more than the
  homepage already renders (name, selling price, stock, image). The whitelist mapper guards
  against future upstream fields leaking. The `API_KEY` stays server-side in
  `src/lib/api-v1/server.ts`.
- **No rate limiting.** CDN `s-maxage=60` plus the 60 s fetch data cache limit Lambda load,
  similar to the homepage. Abuse would mostly hit Vercel's cache. This is acceptable for a
  read-only catalogue projection, but the approver should be aware of it.
- **Lambda/RDS boundary:** unchanged. There are no Lambda, migration or `agent.py` (Windows 7)
  changes.
- **Copy:** the error `message` is Russian and customer-safe. iOS should branch on HTTP status
  and `error.code`, not on the message text.
- **Price type:** `selling_unit_price` is an integer JSON number (TJS). If the Lambda contract
  ever switches to decimals, iOS should decode it as `Decimal`/`Double`. Note this in the
  contract doc.
- **Deployment:** the owner asks whether the route is live on production. Publishing requires
  merging to `main` and a Vercel production deploy. This job must **not** deploy. The report
  must state plainly that the route is not yet published and give the URL
  `https://www.aptekavatan.tj/api/product-carousels` plus a sample response. The approver
  escalates to the owner for deployment.

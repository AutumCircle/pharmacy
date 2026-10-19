VERDICT: PASS

No browser UI changes. The diff adds an anonymous JSON route (`src/app/api/product-carousels/route.ts`), a pure mapper, tests and an API_CONTRACT.md section. The homepage and checkout are untouched, so the UI_DESIGN_SPEC §2 rules (delivery fee, 50 TJS minimum, out-of-stock, admin controls) are not affected.

Checked for API consumers:
- The error message is Russian, plain and calm: "Секции товаров временно недоступны."
- The 503 response carries `Retry-After: 30`, so the client knows when to retry.
- The empty list returns `{ "carousels": [] }`, so the iOS app can show an empty state without treating it as an error.
- `in_stock` is exposed so the iOS app can block adding out-of-stock items.

Notes:
- The iOS app needs to render its own loading, empty and error states from the 503 and empty-list cases.

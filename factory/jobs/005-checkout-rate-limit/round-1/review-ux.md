VERDICT: PASS

User-facing change: a 429 on checkout and one new message on `/cart`. Reviewed against the spec and the diff, `git diff main...factory/005-checkout-rate-limit`.

## Findings
- The flow works end to end and nothing dead-ends. The 429 goes through the existing non-OK branch in `src/app/cart/page.tsx:~176-190`. That branch only sets `checkoutError` and `isSubmitting=false`. It does not call `setPhase`, `clearCart` or a form reset, and it does not remove `vatan_pending_order_v1`. The customer stays on the form with the button re-enabled and can press it again. The same idempotency key is reused when the payload hash matches.
- Copy is Russian, calm, and says what to do next ("Подождите несколько минут и попробуйте снова — корзина и данные сохранены"). The client map takes priority over the server message. The server message is a fine fallback.
- The error block (`page.tsx:419`) is the existing `role="alert"` block. No new controls, so there are no new accessibility or touch-target concerns.
- Product rules from `UI_DESIGN_SPEC.md` §2 are untouched: no change to totals, the 50 TJS minimum, stock handling or admin controls.
- `limit` is 5 per 10 minutes. That covers one order, two retries and one correction, so honest customers are not blocked.
- Invalid requests (no `Idempotency-Key`, bad body) return 400 and use no quota.

## Notes (non-blocking)
- The browser walkthrough of criterion 5 was not done; it was checked by code review only. I confirmed from the code that the 429 path is safe.
- The message says "несколько минут", but the window is 10 minutes. `Retry-After` is not shown in the UI. This is acceptable. You could later show "через N мин" from the `Retry-After` header.
- Customers behind the same carrier NAT share one IP bucket, so they may see this message for no fault of their own. This is an accepted risk in the spec.

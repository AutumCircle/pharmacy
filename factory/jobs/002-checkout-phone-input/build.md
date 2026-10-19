# Build log: 002-checkout-phone-input

## Round 1
- Commits: a453327 Checkout phone: fixed +992 prefix, paste normalisation, full-number summary
- Changed: `src/lib/checkout-phone.ts` (new), `tests/checkout-phone.test.ts` (new), `src/app/cart/page.tsx`,
  `package.json` (test:frontend), `backend/tests/test_contract.py` (optional regression test).
- Design decisions:
  - `formatCheckoutPhoneFull` returns `''` for anything that is not exactly 9 ASCII digits (asserted in the test).
  - `isCompleteCheckoutPhone` added and used for the summary line and the submit guard.
  - Error copy: `CHECKOUT_PHONE_ERROR = 'Введите ровно 9 цифр номера телефона.'` (same text as the tracking page).
  - Removed `minLength={9}` and the native `required` from the phone input, so every incomplete value
    (including empty) gets the Russian error from `handleCheckoutSubmit` instead of a browser-locale tooltip.
    The address check still runs first, as before.
  - `+992` prefix is an `aria-hidden` `<span>` with `userSelect: none` inside a shared bordered flex
    wrapper; the input has `aria-label` mentioning +992 and `autoComplete="tel-national"`.
  - `displayPhone()` (`XXX-XX-XX-XX`) unchanged. Request body still sends `phone: formData.phone`
    (9 local digits); `userPhone` / `invalidateTrackedOrders` untouched. `tracking-phone.ts` untouched.
- Acceptance criteria:
  1 ✅ all 9 listed cases asserted in `tests/checkout-phone.test.ts` (plus partial typing `99`/`992`/`99212`, `00992…` truncation).
  2 ✅ `'+992 917 123 456'` and `'+992 992 123 456'` asserted; incomplete → `''` asserted.
  3 ✅ by code: prefix element rendered separately, outside the input value; placeholder «Введите 9 цифр номера».
     Paste `+992 917 12 34 56` into an empty field → onChange value has 12 digits → `917123456` → shows `917-12-34-56`.
     Not verified in a real browser (no dev server run).
  4 ✅ by code: «Телефон:» row rendered only when `isCompleteCheckoutPhone`, value from `formatCheckoutPhoneFull`.
  5 ✅ by code: guard returns before `localStorage`/`fetch`; body unchanged.
  6 ✅ lint, build, test:frontend pass.
- Tests run (in worktree, after `npm ci`):
  - `node --test tests/checkout-phone.test.ts` → 8/8 pass
  - `npm run test:frontend` → 47/47 pass (includes unchanged tracking-phone tests)
  - `npm run lint` → clean
  - `npm run build` → success
  - `python3 -m unittest discover -s backend/tests -t .` → 248 run; only the 2 known pre-existing failures
    (`test_banner_title_can_be_empty_for_image_only_banner`, `test_quantity_on_delivered_order_recalculates_total_and_audits`)
- Open questions / not done:
  - Manual browser check of paste behaviour (including paste into a partly filled field, which falls back to truncation per spec) still to do.
  - `00992…` / `8…` prefixes intentionally not handled (spec risk note).

# 002-checkout-phone-input: Checkout phone field with separate +992 prefix and paste normalisation

## Owner request (verbatim)

В поле телефона **+992 уже показан отдельно**, а подсказка говорит: «Введите 9 цифр номера». Если клиент вставит из контактов полный номер с `+992`, поле автоматически уберёт код страны из введённой части и оставит 9 цифр. Если сам девятизначный номер начинается с `992`, эти цифры удалять нельзя. Перед оформлением заказа покажите полный номер в виде **+992 XXX XXX XXX**.

## Goal
This job changes the phone field on the customer checkout step (`/cart`, `phase === 'checkout'`).
The field shows `+992` as a fixed prefix, separate from the input, and the placeholder reads
«Введите 9 цифр номера». At the moment `handlePhoneChange` strips every non-digit and keeps the
first 9 digits. So when a customer pastes `+992 917 12 34 56` from contacts, the field keeps
`992917123` and the order goes out with the wrong number. After this job, a pasted full `+992`
number keeps only the 9 local digits. A 9-digit local number that itself starts with `992` stays
as it is. Before the customer presses «Оформить заказ», the summary block shows the full number as
`+992 XXX XXX XXX`, so the customer can check it.

## Scope
- New pure helper module `src/lib/checkout-phone.ts`. It has no React and no browser APIs, so
  `node --test` can import it. It exports:
  - `normalizeCheckoutPhoneInput(raw: string): string` returns at most 9 local digits. Rules:
    1. Take the ASCII digits of `raw`.
    2. If there are exactly 12 digits and they start with `992`, drop the first 3.
    3. Otherwise keep the first 9 digits, as the current behaviour does.
    4. A value with 9 or fewer digits is never stripped, even if it starts with `992`.
  - `formatCheckoutPhoneFull(localDigits: string): string` returns `+992 XXX XXX XXX` (3-3-3,
    single spaces) for exactly 9 digits. For any other length it returns `''` or a partial value;
    the builder picks one and documents it in the test.
  - Optionally `isCompleteCheckoutPhone(localDigits)` (true only for exactly 9 digits).
  - The builder may reuse `formatLocalTrackingPhone` from `src/lib/tracking-phone.ts`. Do not
    change the behaviour of `parseTrackingPhone`.
- `src/app/cart/page.tsx`, checkout form only:
  - Render `+992` as a visible, non-editable prefix element next to the input, inside the same
    visual field. The input holds only the local part.
  - Placeholder/hint text: «Введите 9 цифр номера».
  - `handlePhoneChange` uses `normalizeCheckoutPhoneInput`. The in-field formatting
    `XXX-XX-XX-XX` (`displayPhone`) may stay.
  - The phone value loaded from `localStorage.vatan_customer` is passed through the same
    normaliser.
  - In the summary block above the submit button, add a line «Телефон: +992 XXX XXX XXX» from
    `formatCheckoutPhoneFull`. It is shown only when 9 digits are present.
  - In `handleCheckoutSubmit`, block submission with a Russian error when the local part is not
    exactly 9 digits. The current `minLength={9}` is checked against the hyphenated string, so
    7 digits pass it.
  - The request body still sends `phone` as the 9 local digits. Do not change the
    `localStorage.userPhone` or `invalidateTrackedOrders` semantics.
- `package.json`: add the new test file to `test:frontend`.
- Out of scope:
  - `backend/v1` (`normalize_phone` already handles 9-digit and 12-digit `992…` input correctly);
  - `src/app/api/checkout/route.ts`;
  - the tracking page, the staff/admin phone editors and `formatTajikPhone`;
  - the success screen text;
  - `db/migrations`, `backend/local-agent/agent.py`, API Gateway.

## Acceptance criteria
1. `normalizeCheckoutPhoneInput` gives these results:
   - `'+992 917 12 34 56'` → `'917123456'`
   - `'+992917123456'` → `'917123456'`
   - `'992917123456'` → `'917123456'`
   - `'(+992) 917-12-34-56'` → `'917123456'`
   - `'992123456'` → `'992123456'` (local number starting with 992 is kept)
   - `'992-12-34-56'` → `'992123456'`
   - `'+992 992 12 34 56'` → `'992123456'`
   - `'9171234567'` → `'917123456'` (truncate, unchanged behaviour)
   - `''` → `''`
2. `formatCheckoutPhoneFull('917123456')` returns exactly `'+992 917 123 456'`, and
   `formatCheckoutPhoneFull('992123456')` returns `'+992 992 123 456'`.
3. On `/cart` at the checkout step, `+992` is visible as a separate fixed element in front of the
   phone input and cannot be edited or deleted. The empty input shows «Введите 9 цифр номера».
   Manual check: pasting `+992 917 12 34 56` into the input shows `917-12-34-56`, not
   `992-91-71-23`.
4. With 9 digits entered, the summary block above «Оформить заказ» shows `+992 917 123 456`
   (format `+992 XXX XXX XXX`). With fewer digits, no full number is shown there.
5. Submitting with fewer than 9 digits sends no request to `/api/checkout` and shows a Russian
   error, for example «Введите ровно 9 цифр номера телефона.». A valid submit sends
   `phone: "917123456"`, the 9 local digits, as before.
6. `npm run lint`, `npm run build` and `npm run test:frontend` pass. The `test:frontend` script
   includes the new test file.

## Tests
- Add `tests/checkout-phone.test.ts` (`node --test`, importing `../src/lib/checkout-phone.ts`). It
  asserts every case in criteria 1–2:
  - 12-digit `992…` paste with and without `+`/separators;
  - a 9-digit local number starting with `992` is preserved, both bare and formatted;
  - truncation of over-long non-`992` input;
  - empty input;
  - the exact `+992 XXX XXX XXX` output, and the agreed output for incomplete input.
- Optional, as a regression guard for the server side of the same rule: extend
  `backend/tests/test_contract.py` with `normalize_phone("992123456") == "+992992123456"` and
  `normalize_phone("+992 992 12 34 56") == "+992992123456"`. No backend code change is expected.
- The existing `tests/tracking-phone.test.ts` must still pass unchanged.

## Risks
- **Ambiguity is limited to 12 digits.** Only the exact case "12 digits starting with `992`" is
  stripped. Input such as `00992…` (14 digits) or `8…` prefixes is not handled and falls back to
  truncation. If the owner wants that handled, raise it as a follow-up; do not improvise.
- **Typing versus paste.** The cap of 9 digits means typed input never reaches 12 digits, so a
  customer typing `992…` by hand keeps those digits, as required. A paste into an already
  partly filled field may produce a mixed value that falls under the truncation rule. That is
  acceptable, but it should be checked manually.
- **Russian copy.** Use «Введите 9 цифр номера» exactly as the owner wrote it. The new summary
  label and the validation error must be in Russian.
- **Format inconsistency.** The checkout summary uses 3-3-3 (`+992 917 123 456`), while the input
  uses `XXX-XX-XX-XX` and `formatTajikPhone` elsewhere uses 2-3-2-2. This job only does what the
  owner asked. Do not change the other formatters.
- **Boundary/security.** This is frontend-only. The Lambda remains authoritative through
  `normalize_phone`, and no data path changes.
- **No deployment, migration or `backend/local-agent/agent.py` change is required.** Windows 7
  agent compatibility is not affected.

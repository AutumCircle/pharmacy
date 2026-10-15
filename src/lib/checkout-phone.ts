// Pure helpers for the customer checkout phone field (`/cart`, checkout step).
// The field shows `+992` as a fixed prefix; the input holds only the 9 local digits.
// No React or browser APIs here so `node --test` can import this module.

export const CHECKOUT_PHONE_LOCAL_LENGTH = 9;
export const CHECKOUT_PHONE_COUNTRY_CODE = '992';
export const CHECKOUT_PHONE_ERROR = 'Введите ровно 9 цифр номера телефона.';

/**
 * Turns raw input (typed or pasted) into at most 9 local digits.
 *
 * - Only ASCII digits are kept.
 * - Exactly 12 digits starting with `992` (a full `+992…` number pasted from contacts)
 *   lose the country code.
 * - Anything else is truncated to the first 9 digits, so a local number that itself
 *   starts with `992` is never stripped.
 */
export function normalizeCheckoutPhoneInput(raw: string): string {
  const digits = (typeof raw === 'string' ? raw : '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith(CHECKOUT_PHONE_COUNTRY_CODE)) {
    return digits.slice(3);
  }
  return digits.slice(0, CHECKOUT_PHONE_LOCAL_LENGTH);
}

export function isCompleteCheckoutPhone(localDigits: string): boolean {
  return /^[0-9]{9}$/.test(localDigits);
}

/**
 * Full number for the checkout summary: `+992 XXX XXX XXX`.
 * Returns `''` unless `localDigits` is exactly 9 ASCII digits.
 */
export function formatCheckoutPhoneFull(localDigits: string): string {
  if (!isCompleteCheckoutPhone(localDigits)) return '';
  return `+${CHECKOUT_PHONE_COUNTRY_CODE} ${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6, 9)}`;
}

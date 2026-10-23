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

/** What the input shows for up to 9 local digits: `917 12 34 56` (groups 3-2-2-2, spaces only). */
export function formatCheckoutPhoneInput(localDigits: string): string {
  const digits = localDigits.replace(/[^0-9]/g, '').slice(0, CHECKOUT_PHONE_LOCAL_LENGTH);
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(' ');
}

/** Caret position in a formatted value right after the `digitCount`-th digit (0 = start). */
export function caretAfterDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/[0-9]/.test(formatted[index])) {
      seen += 1;
      if (seen === digitCount) return index + 1;
    }
  }
  return formatted.length;
}

export type CheckoutPhoneEdit = {
  /** Digits before the edit (state). */
  previousDigits: string;
  /** The input's raw value after the browser applied the edit. */
  value: string;
  /** `selectionStart` after the browser applied the edit. */
  selectionStart: number | null;
  /** `InputEvent.inputType`, e.g. `deleteContentBackward`; empty when unknown. */
  inputType?: string;
};

/**
 * Applies one edit of the masked phone input and says where the caret goes.
 *
 * The fix for the «stuck on a separator» bug: Backspace right after a space removes only the space, the
 * digits stay the same and the redrawn value puts the space back. In that case the digit before the caret
 * is removed instead (Delete: the digit after it), so every key press changes the number.
 */
export function applyCheckoutPhoneEdit(edit: CheckoutPhoneEdit): { digits: string; formatted: string; caret: number } {
  const value = typeof edit.value === 'string' ? edit.value : '';
  const caretInValue = edit.selectionStart ?? value.length;
  const rawDigits = value.replace(/[^0-9]/g, '');
  let digits = normalizeCheckoutPhoneInput(value);
  let caretDigits = value.slice(0, caretInValue).replace(/[^0-9]/g, '').length;
  if (digits !== rawDigits) {
    // Country code stripped or extra digits cut: the caret goes to the end of what is kept.
    caretDigits = digits.length;
  } else if (digits === edit.previousDigits && edit.inputType === 'deleteContentBackward' && caretDigits > 0) {
    digits = digits.slice(0, caretDigits - 1) + digits.slice(caretDigits);
    caretDigits -= 1;
  } else if (digits === edit.previousDigits && edit.inputType === 'deleteContentForward' && caretDigits < digits.length) {
    digits = digits.slice(0, caretDigits) + digits.slice(caretDigits + 1);
  }
  const formatted = formatCheckoutPhoneInput(digits);
  return { digits, formatted, caret: caretAfterDigits(formatted, Math.min(caretDigits, digits.length)) };
}

/**
 * Full number for the checkout summary: `+992 XXX XXX XXX`.
 * Returns `''` unless `localDigits` is exactly 9 ASCII digits.
 */
export function formatCheckoutPhoneFull(localDigits: string): string {
  if (!isCompleteCheckoutPhone(localDigits)) return '';
  return `+${CHECKOUT_PHONE_COUNTRY_CODE} ${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6, 9)}`;
}

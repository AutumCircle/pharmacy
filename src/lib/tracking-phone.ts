export const TRACKING_PHONE_ERROR = 'Введите ровно 9 цифр номера телефона.';
export const TRACKING_PHONE_FORMAT_ERROR = 'Используйте только цифры и обычные разделители номера.';

export type TrackingPhoneParseResult = {
  localDigits: string;
  formatted: string;
  normalized: string | null;
  valid: boolean;
  error: string | null;
};

export function formatLocalTrackingPhone(localDigits: string): string {
  const digits = localDigits.slice(0, 9);
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7), digits.slice(7, 9)]
    .filter(Boolean)
    .join('-');
}

export function parseTrackingPhone(value: unknown): TrackingPhoneParseResult {
  if (typeof value !== 'string') {
    return { localDigits: '', formatted: '', normalized: null, valid: false, error: TRACKING_PHONE_ERROR };
  }
  const allowed = /^[0-9\s()+./-]*$/;
  const asciiDigits = value.replace(/[^0-9]/g, '');
  const localDigits = asciiDigits.length === 12 && asciiDigits.startsWith('992')
    ? asciiDigits.slice(3)
    : asciiDigits;
  const formatted = formatLocalTrackingPhone(localDigits);
  if (!allowed.test(value)) {
    return { localDigits, formatted, normalized: null, valid: false, error: TRACKING_PHONE_FORMAT_ERROR };
  }
  if (localDigits.length !== 9) {
    return { localDigits, formatted, normalized: null, valid: false, error: TRACKING_PHONE_ERROR };
  }
  return {
    localDigits,
    formatted,
    normalized: `+992${localDigits}`,
    valid: true,
    error: null,
  };
}

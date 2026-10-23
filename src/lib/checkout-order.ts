// Pure helpers for the customer cart, checkout and order screens, and for showing a website order's address,
// landmark and payment to staff. No React or browser APIs here so `node --test` can import this module.

export const MINIMUM_ORDER_TOTAL = 50;
export const MAX_SAVED_ADDRESSES = 8;

export type CheckoutPaymentMethod = 'cash_on_delivery' | 'e_wallet';

export const CHECKOUT_PAYMENT_OPTIONS: ReadonlyArray<{ value: CheckoutPaymentMethod; title: string; hint: string }> = [
  { value: 'cash_on_delivery', title: 'Наличными', hint: 'Курьеру при получении' },
  { value: 'e_wallet', title: 'Электронный кошелёк', hint: 'Переводом при получении' },
];

const PAYMENT_LABELS: Record<string, string> = {
  cash_on_delivery: 'Наличными курьеру',
  e_wallet: 'Электронный кошелёк',
};

/** Label of an order's payment method; unknown or missing values (older orders) read as cash. */
export function paymentMethodLabel(method: unknown): string {
  return PAYMENT_LABELS[typeof method === 'string' ? method : ''] ?? PAYMENT_LABELS.cash_on_delivery;
}

/** How many сомони are still missing to the 50 с. minimum; 0 once it is reached. */
export function minimumOrderShortfall(total: number): number {
  if (!Number.isFinite(total)) return MINIMUM_ORDER_TOTAL;
  return Math.max(0, Math.ceil((MINIMUM_ORDER_TOTAL - total) * 100) / 100);
}

/** Money as the site shows it: whole сомони, «186 с.». */
export function formatSom(value: number | string | null | undefined): string {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${Number.isFinite(number) ? Math.round(number as number) : 0} с.`;
}

export type DeliveryAddress = { address: string; landmark: string };

const LEGACY_LANDMARK = /^([\s\S]*\S)\s*\(([^()]*\S[^()]*)\)\s*$/;

/**
 * Before the checkout redesign the landmark was glued to the address as «Адрес (Ориентир)». For display only:
 * an order without its own landmark whose address ends in «(…)» is shown as address + landmark. Nothing in
 * the database is changed; an order that has a landmark is returned as it is.
 */
export function splitLegacyAddress(address: string | null | undefined, landmark?: string | null): DeliveryAddress {
  const cleanAddress = (address ?? '').trim();
  const cleanLandmark = (landmark ?? '').trim();
  if (cleanLandmark) return { address: cleanAddress, landmark: cleanLandmark };
  const match = LEGACY_LANDMARK.exec(cleanAddress);
  if (!match || match[1].trim().length < 2) return { address: cleanAddress, landmark: '' };
  return { address: match[1].trim(), landmark: match[2].trim() };
}

function addressKey(entry: DeliveryAddress): string {
  return `${entry.address.toLocaleLowerCase('ru')}\u0000${entry.landmark.toLocaleLowerCase('ru')}`;
}

/**
 * Addresses remembered in this browser (`localStorage.vatan_addresses`). Old entries are strings in the
 * «Адрес (Ориентир)» form; they are split the same way. Invalid or empty entries are dropped, duplicates
 * removed, at most MAX_SAVED_ADDRESSES kept.
 */
export function parseSavedAddresses(raw: unknown): DeliveryAddress[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const result: DeliveryAddress[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    let parsed: DeliveryAddress | null = null;
    if (typeof entry === 'string') {
      parsed = splitLegacyAddress(entry);
    } else if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      if (typeof record.address === 'string') {
        parsed = { address: record.address.trim(), landmark: typeof record.landmark === 'string' ? record.landmark.trim() : '' };
      }
    }
    if (!parsed || parsed.address.length < 5) continue;
    const key = addressKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed);
    if (result.length >= MAX_SAVED_ADDRESSES) break;
  }
  return result;
}

/** The list after an order to `entry`: that address first, no duplicates, capped. */
export function rememberAddress(list: DeliveryAddress[], entry: DeliveryAddress): DeliveryAddress[] {
  const clean = { address: entry.address.trim(), landmark: entry.landmark.trim() };
  if (clean.address.length < 5) return list;
  const key = addressKey(clean);
  return [clean, ...list.filter((item) => addressKey(item) !== key)].slice(0, MAX_SAVED_ADDRESSES);
}

export function sameAddress(left: DeliveryAddress | null, right: DeliveryAddress | null): boolean {
  return Boolean(left && right && addressKey(left) === addressKey(right));
}

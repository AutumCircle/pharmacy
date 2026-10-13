export function money(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount : 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с.`;
}

export function quantityLabel(value: number | string): string {
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** Normalised "12.50"-style price, or null when the input is not a valid positive price. */
export function parsePrice(input: string): string | null {
  const value = input.replace(',', '.').trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) return null;
  return value;
}

export function priceInput(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

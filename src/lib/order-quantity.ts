/** Order quantities have at most two decimal places; buttons move by one tenth. */
export function isValidOrderQuantity(value: number): boolean {
  return Number.isFinite(value) && value >= 0.1 && value <= 99 && Number(value.toFixed(2)) === value;
}

export function parseOrderQuantity(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return isValidOrderQuantity(value) ? value : null;
}

export function shiftOrderQuantity(value: number, direction: -1 | 1): number {
  return Math.min(99, Math.max(0.1, Math.round((value + direction * 0.1) * 100) / 100));
}

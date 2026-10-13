const PRICE_PATTERN = /^\d{1,6}(?:\.\d{1,2})?$/;

export function isOrderPrice(value: unknown): value is string {
  return typeof value === 'string' && PRICE_PATTERN.test(value) && Number(value) > 0;
}

export function isOrderQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 99
    && Number.isInteger(value * 2);
}

/** Catalogue line: medicine_id + quantity, plus an optional courier-set client price. */
export function isCatalogOrderItem(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const fields = item as Record<string, unknown>;
  const keys = Object.keys(fields);
  return keys.every((key) => key === 'medicine_id' || key === 'quantity' || key === 'unit_price')
    && Number.isInteger(fields.medicine_id) && Number(fields.medicine_id) > 0
    && isOrderQuantity(fields.quantity)
    && (fields.unit_price === undefined || isOrderPrice(fields.unit_price));
}

export function isManualOrderItem(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const fields = item as Record<string, unknown>;
  return Object.keys(fields).length === 3 && typeof fields.medicine_name === 'string'
    && fields.medicine_name.trim().length >= 2 && fields.medicine_name.trim().length <= 200
    && isOrderPrice(fields.price) && isOrderQuantity(fields.quantity);
}

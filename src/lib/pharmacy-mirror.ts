export type OracleValue = string | number | boolean | null;
export type OracleRow = {
  row_key: string;
  change_id: number | null;
  source_generated_at: string;
  received_at: string;
  oracle: Record<string, OracleValue>;
  warehouse_name?: string | null;
  income_date_old?: string | null;
  purchase_price?: string | null;
  income_barcode?: string | null;
};
export type MirrorPrices = {
  sale_price_min: string | null;
  sale_price_max: string | null;
  purchase_price_min: string | null;
  purchase_price_max: string | null;
  sale_value: string | null;
  purchase_value: string | null;
  price_basis: 'in_stock' | 'historical' | 'none';
};
export type MirrorStock = MirrorPrices & {
  total_stock: string | null;
  stock_rows: number;
  invalid_stock_rows: number;
  stock_received_at: string | null;
  stock_max_change_id: number | null;
  stock_generated_at: string | null;
};
export type MirrorProduct = MirrorStock & {
  product_id: string;
  name: string;
  barcode: string | null;
  vendor: string | null;
  received_at: string;
  source_generated_at: string;
  change_id: number | null;
};
export type MirrorPage<T> = { items: T[]; total: number; page: number; limit: number };
export type MirrorStatus = {
  pharmacy_id: number;
  name: string;
  last_seen_at: string | null;
  last_batch_at: string | null;
  freshness: 'current' | 'stale';
  stale_seconds: number;
  checked_at: string;
  last_batch: {
    batch_id: string;
    table_name: string;
    received_at: string;
    upserted_count: number;
    deleted_count: number;
  } | null;
  tables: {
    table_name: string;
    row_count: number;
    max_change_id: number | null;
    last_received_at: string | null;
    source_generated_at: string | null;
    freshness: 'current' | 'stale';
  }[];
};
export type MirrorDetail = {
  checked_at: string;
  product: OracleRow;
  dictionaries: Record<
    'vendor' | 'country' | 'mnn' | 'group' | 'measure' | 'type',
    { id: OracleValue; name: string | null }
  >;
  stock: MirrorStock;
  stocks: MirrorPage<OracleRow>;
  incomes: MirrorPage<OracleRow>;
  site_comparison: { available: boolean; reason: string };
};

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function nullableString(value: unknown) {
  return value === null || typeof value === 'string';
}
function timestamp(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function nullableTime(value: unknown) {
  return value === null || timestamp(value);
}
function change(value: unknown) {
  return value === null || count(value);
}
function stock(value: unknown): boolean {
  return (
    object(value) &&
    nullableString(value.total_stock) &&
    [
      'sale_price_min',
      'sale_price_max',
      'purchase_price_min',
      'purchase_price_max',
      'sale_value',
      'purchase_value',
    ].every((k) => nullableString(value[k])) &&
    ['in_stock', 'historical', 'none'].includes(String(value.price_basis)) &&
    count(value.stock_rows) &&
    count(value.invalid_stock_rows) &&
    nullableTime(value.stock_received_at) &&
    nullableTime(value.stock_generated_at) &&
    change(value.stock_max_change_id)
  );
}
function row(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.row_key === 'string' &&
    change(value.change_id) &&
    timestamp(value.received_at) &&
    timestamp(value.source_generated_at) &&
    object(value.oracle) &&
    Object.keys(value.oracle).length <= 100 &&
    Object.values(value.oracle).every(
      (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
    )
  );
}
function page(value: unknown, check: (v: unknown) => boolean): boolean {
  return (
    object(value) &&
    value.limit === 25 &&
    count(value.total) &&
    count(value.page) &&
    value.page > 0 &&
    Array.isArray(value.items) &&
    value.items.length <= 25 &&
    value.items.every(check)
  );
}
export function validMirrorProducts(value: unknown): value is MirrorPage<MirrorProduct> {
  return page(
    value,
    (v) =>
      object(v) &&
      stock(v) &&
      typeof v.product_id === 'string' &&
      typeof v.name === 'string' &&
      nullableString(v.barcode) &&
      nullableString(v.vendor) &&
      timestamp(v.received_at) &&
      timestamp(v.source_generated_at) &&
      change(v.change_id),
  );
}
export function validMirrorStatus(v: unknown): v is MirrorStatus {
  return (
    object(v) &&
    v.pharmacy_id === 1 &&
    typeof v.name === 'string' &&
    nullableTime(v.last_seen_at) &&
    nullableTime(v.last_batch_at) &&
    timestamp(v.checked_at) &&
    ['current', 'stale'].includes(String(v.freshness)) &&
    count(v.stale_seconds) &&
    (v.last_batch === null ||
      (object(v.last_batch) &&
        typeof v.last_batch.batch_id === 'string' &&
        typeof v.last_batch.table_name === 'string' &&
        timestamp(v.last_batch.received_at) &&
        count(v.last_batch.upserted_count) &&
        count(v.last_batch.deleted_count))) &&
    Array.isArray(v.tables) &&
    v.tables.length === 12 &&
    v.tables.every(
      (t) =>
        object(t) &&
        typeof t.table_name === 'string' &&
        count(t.row_count) &&
        change(t.max_change_id) &&
        nullableTime(t.last_received_at) &&
        nullableTime(t.source_generated_at) &&
        ['current', 'stale'].includes(String(t.freshness)),
    )
  );
}
export function validMirrorDetail(v: unknown): v is MirrorDetail {
  return (
    object(v) &&
    timestamp(v.checked_at) &&
    row(v.product) &&
    stock(v.stock) &&
    page(v.stocks, row) &&
    page(v.incomes, row) &&
    object(v.dictionaries) &&
    ['vendor', 'country', 'mnn', 'group', 'measure', 'type'].every((k) => {
      const d = (v.dictionaries as ObjectValue)[k];
      return object(d) && nullableString(d.name);
    }) &&
    object(v.site_comparison) &&
    v.site_comparison.available === false &&
    typeof v.site_comparison.reason === 'string'
  );
}

export function mirrorTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString('ru-RU', {
        timeZone: 'Asia/Dushanbe',
        dateStyle: 'short',
        timeStyle: 'medium',
      })
    : 'Нет данных';
}
export function mirrorQuantity(value: string | null, rows: number, invalid: number) {
  return invalid
    ? 'Есть некорректные значения'
    : rows === 0
      ? 'Нет данных об остатке в зеркале'
      : (value ?? 'Нет данных');
}
export function mirrorSearchError(q: string, mode: string) {
  if (!q.trim()) return '';
  if (q.trim().length > 120) return 'Не более 120 символов.';
  if (!['auto', 'name', 'id', 'barcode'].includes(mode)) return 'Неизвестный тип поиска.';
  if (mode === 'id' && !/^[0-9]{1,18}$/.test(q.trim())) return 'ID должен содержать только цифры.';
  if ((mode === 'name' || !/^[0-9]+$/.test(q.trim())) && q.trim().length < 2)
    return 'Введите минимум 2 символа.';
  return '';
}

export function mirrorMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'Нет данных';
  const match = /^(-?)([0-9]+)(?:[.]([0-9]+))?$/.exec(String(value));
  if (!match) return 'Нет данных';
  const decimals = (match[3] || '').replace(/0+$/, '');
  return (
    match[1] +
    match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') +
    ',' +
    (decimals || '00').padEnd(2, '0') +
    ' с.'
  );
}
export function mirrorPriceRange(min: string | null, max: string | null): string {
  if (min === null || max === null) return 'Нет данных';
  const low = mirrorMoney(min),
    high = mirrorMoney(max);
  return low === high ? low : low + ' — ' + high;
}

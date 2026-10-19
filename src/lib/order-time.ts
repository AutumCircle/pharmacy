export const ORDER_TIME_ZONE = 'Asia/Dushanbe';

// Old API responses omitted the UTC offset. Treat them as UTC until all Lambdas are updated.
export function parseOrderTime(value: string): Date {
  const explicit = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const parsed = new Date(explicit ? value : `${value}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid order timestamp');
  return parsed;
}

export function formatOrderDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: ORDER_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(parseOrderTime(value));
}

export function formatOrderDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: ORDER_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(parseOrderTime(value));
}

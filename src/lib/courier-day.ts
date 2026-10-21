import type { CourierDaySummary, CourierOrderFilter } from './api-v1/staff-types';

/** Courier days follow the pharmacy's clock, like the Lambda's `date` filter. */
export const COURIER_DAY_TIME_ZONE = 'Asia/Dushanbe';

export const courierStatusFilters: Array<{ value: CourierOrderFilter | ''; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Новые' },
  { value: 'confirmed', label: 'Собираются' },
  { value: 'delivering', label: 'В пути' },
  { value: 'delivered', label: 'Доставлены' },
  { value: 'undelivered', label: 'Не доставлены' },
  { value: 'cancelled', label: 'Отменённые' },
];

/** Status filter from the URL; anything unknown means «Все». */
export function parseCourierFilter(value: string | undefined): CourierOrderFilter | '' {
  return courierStatusFilters.find((filter) => filter.value && filter.value === value)?.value || '';
}

/** `YYYY-MM-DD` of `now` in Dushanbe. */
export function dushanbeDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: COURIER_DAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** A real calendar day `YYYY-MM-DD` within the Lambda's 2020–2100 range, otherwise undefined. */
export function parseCourierDay(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return undefined;
  const year = parsed.getUTCFullYear();
  return year >= 2020 && year <= 2100 ? value : undefined;
}

export function shiftDay(day: string, days: number): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** «Сегодня», «Вчера» or «18 октября 2026». */
export function courierDayTitle(day: string, today: string): string {
  if (day === today) return 'Сегодня';
  if (day === shiftDay(today, -1)) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${day}T00:00:00Z`)).replace(/\s*г\.$/, '');
}

export function courierOrdersHref(values: { status?: CourierOrderFilter | ''; date?: string; cursor?: string }): string {
  const params = new URLSearchParams();
  if (values.date) params.set('date', values.date);
  if (values.status) params.set('status', values.status);
  if (values.cursor) params.set('cursor', values.cursor);
  const query = params.toString();
  return query ? `/staff/orders?${query}` : '/staff/orders';
}

/** One short line for the selected day, e.g. «Заказов: 5 · доставлено: 3 · не доставлено: 2». */
export function courierDaySummaryText(summary: CourierDaySummary): string {
  const parts = [`Заказов: ${summary.total}`, `доставлено: ${summary.delivered}`,
    `не доставлено: ${summary.undelivered}`];
  if (summary.cancelled > 0) parts.push(`отменено: ${summary.cancelled}`);
  return parts.join(' · ');
}

/** Empty-list text for the chosen day and status. */
export function courierEmptyText(filter: CourierOrderFilter | '', day: string | undefined): string {
  if (filter === 'cancelled') return day ? 'В этот день отменённых заказов нет.' : 'Отменённых заказов нет.';
  if (day) return 'В этот день таких заказов нет.';
  return 'Новые заказы появятся здесь.';
}

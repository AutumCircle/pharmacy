import type { OrderStatus } from '@/lib/api-v1/types';
import { orderStage, orderStageLabel } from '@/lib/order-stage';

export const ORIGIN_COLORS = { website: '#c4161c', courier: '#1d5f9a', pharmacy: '#b7791f' } as const;

/** Bare status labels (history, transitions). Job 013: pending is «Собирается», confirmed «Подтверждён». */
export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Собирается', confirmed: 'Подтверждён', delivering: 'В пути', delivered: 'Доставлен', cancelled: 'Отменён',
};

/** Chip text and classes of an order: the Lambda's `stage` («Собран» is pending + all pharmacies assembled). */
export function stageChip(order: { status: OrderStatus; stage?: unknown }): { label: string; className: string } {
  const assembled = orderStage(order) === 'assembled';
  return {
    label: orderStageLabel(order),
    className: `ao-status ao-status-${order.status}${assembled ? ' ao-stage-assembled' : ''}`,
  };
}

export function money(value: number | string | null | undefined, digits = 0): string {
  const amount = Number(value ?? 0);
  return `${(Number.isFinite(amount) ? amount : 0).toLocaleString('ru-RU', {
    minimumFractionDigits: digits, maximumFractionDigits: 2,
  })} с.`;
}

export function count(value: number, one: string, few: string, many: string): string {
  const last = value % 10, lastTwo = value % 100;
  const word = last === 1 && lastTwo !== 11 ? one
    : [2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo) ? few : many;
  return `${value.toLocaleString('ru-RU')} ${word}`;
}

export function origin(createdBy: number | null | undefined): { key: keyof typeof ORIGIN_COLORS; label: string } {
  if (createdBy === null || createdBy === undefined) return { key: 'website', label: 'Сайт' };
  if (createdBy === 3) return { key: 'courier', label: 'Курьер' };
  return { key: 'pharmacy', label: `Аптека ${createdBy}` };
}

export function dayLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T12:00:00+05:00`).toLocaleDateString('ru-RU', { timeZone: 'Asia/Dushanbe', ...options });
}

export function minutesAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч ${minutes % 60} мин назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

export function percent(part: number, total: number): number {
  return total > 0 ? Math.round(part / total * 1000) / 10 : 0;
}

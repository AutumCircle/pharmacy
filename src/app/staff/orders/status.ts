import type { CourierOrderStatus } from '@/lib/api-v1/staff-types';
import { orderStage, orderStageLabel } from '@/lib/order-stage';

/** Bare status labels. Job 013: pending is «Собирается», confirmed «Подтверждён». */
export const statusLabels: Record<CourierOrderStatus, string> = {
  pending: 'Собирается', confirmed: 'Подтверждён', delivering: 'В пути',
  delivered: 'Доставлен', cancelled: 'Отменён',
};

export const statusFlow: CourierOrderStatus[] = ['pending', 'confirmed', 'delivering', 'delivered'];

export const nextStep: Partial<Record<CourierOrderStatus, { status: CourierOrderStatus; label: string }>> = {
  pending: { status: 'confirmed', label: 'Согласовано' },
  confirmed: { status: 'delivering', label: 'Выехал к клиенту' },
  delivering: { status: 'delivered', label: 'Заказ доставлен' },
};

/** Pill text and class from the Lambda's `stage` («Собран» = pending and every pharmacy assembled). */
export function stagePill(order: { status: CourierOrderStatus; stage?: unknown }): { label: string; className: string } {
  const assembled = orderStage(order) === 'assembled';
  return { label: orderStageLabel(order), className: `c-pill c-pill-${order.status}${assembled ? ' c-pill-assembled' : ''}` };
}

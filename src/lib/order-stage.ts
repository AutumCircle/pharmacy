// Job 013: one table of order stages for the customer (/tracking), the courier and the admin.
// The stage is derived in Lambda (backend/v1/shared/order_stage.py) from orders.status and the
// pharmacies' assembly marks; the browser never sends it. «Собран» is a pending website order whose
// every pharmacy pressed «Сборка сделана». An older Lambda without `stage` falls back to `status`.

export type OrderStage = 'assembling' | 'assembled' | 'confirmed' | 'delivering' | 'delivered' | 'cancelled';

export const ORDER_STAGES: readonly OrderStage[] = [
  'assembling', 'assembled', 'confirmed', 'delivering', 'delivered', 'cancelled',
];

export const ORDER_STAGE_LABELS: Record<OrderStage, string> = {
  assembling: 'Собирается',
  assembled: 'Собран',
  confirmed: 'Подтверждён',
  delivering: 'В пути',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

/** The five customer steps of /tracking, in order («Заказ отменён» is shown instead for cancelled). */
export const TRACKING_STEPS: readonly OrderStage[] = ['assembling', 'assembled', 'confirmed', 'delivering', 'delivered'];

const STATUS_FALLBACK: Record<string, OrderStage> = {
  pending: 'assembling',
  confirmed: 'confirmed',
  delivering: 'delivering',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

export function isOrderStage(value: unknown): value is OrderStage {
  return typeof value === 'string' && (ORDER_STAGES as readonly string[]).includes(value);
}

/** The stage the Lambda computed, else the status fallback (pending -> «Собирается»). */
export function orderStage(order: { stage?: unknown; status?: unknown }): OrderStage {
  if (isOrderStage(order.stage)) return order.stage;
  return typeof order.status === 'string' ? STATUS_FALLBACK[order.status] ?? 'assembling' : 'assembling';
}

/** Russian label of the order stage (with the status fallback for an old Lambda). */
export function orderStageLabel(order: { stage?: unknown; status?: unknown }): string {
  return ORDER_STAGE_LABELS[orderStage(order)];
}

/** Label of a bare status (status history, filters): pending is «Собирается». */
export function statusStageLabel(status: string): string {
  return ORDER_STAGE_LABELS[STATUS_FALLBACK[status] ?? 'assembling'];
}

/** Index of the current /tracking step (0..4), or -1 for a cancelled order. */
export function trackingStepIndex(order: { stage?: unknown; status?: unknown }): number {
  const stage = orderStage(order);
  return stage === 'cancelled' ? -1 : TRACKING_STEPS.indexOf(stage);
}

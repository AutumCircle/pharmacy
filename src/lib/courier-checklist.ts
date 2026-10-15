import type { CourierOrder, CourierOrderStatus } from './api-v1/staff-types';

// Courier delivery checklist. Internal to the courier: steps never become order statuses and are
// never shown on the customer tracking page. Steps 3, 6 and 8 are derived from the order status
// (Lambda refuses to store them); the other steps are ticked by the courier and saved in RDS.

export type ChecklistStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ChecklistStep = {
  step: ChecklistStepNumber;
  title: string;
  hint: string;
  /** For a status-linked step: the status move that completes it. */
  status?: { from: CourierOrderStatus; to: CourierOrderStatus; action: string; doneWhen: CourierOrderStatus[] };
};

export type ChecklistOrder = Pick<CourierOrder, 'status' | 'website_order' | 'checklist_steps'>
  & Partial<Pick<CourierOrder, 'own_order'>>;

export type ChecklistProgress = { done: number; total: 8; next: ChecklistStep | null };

export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  { step: 1, title: 'Указать плату за доставку', hint: 'Впишите сумму в поле «Мне за доставку».' },
  { step: 2, title: 'Позвонить клиенту', hint: 'Уточните адрес, ориентир и удобное время.' },
  { step: 3, title: 'Подтвердить заказ', hint: 'Статус станет «Собирается».',
    status: { from: 'pending', to: 'confirmed', action: 'Подтвердить', doneWhen: ['confirmed', 'delivering', 'delivered'] } },
  { step: 4, title: 'Передать список в аптеку', hint: 'Перешлите аптеке список товаров на сборку.' },
  { step: 5, title: 'Забрать заказ в аптеке', hint: 'Сверьте товары и количество по списку.' },
  { step: 6, title: 'Выехать к клиенту', hint: 'Статус станет «В пути».',
    status: { from: 'confirmed', to: 'delivering', action: 'Выехал', doneWhen: ['delivering', 'delivered'] } },
  { step: 7, title: 'Вручить заказ и получить оплату', hint: 'Сумма к оплате — в блоке «Товары».' },
  { step: 8, title: 'Отметить доставку', hint: 'Статус станет «Доставлен».',
    status: { from: 'delivering', to: 'delivered', action: 'Доставлен', doneWhen: ['delivered'] } },
];

export const MANUAL_CHECKLIST_STEPS: readonly number[] = CHECKLIST_STEPS.filter((item) => !item.status).map((item) => item.step);

export function isManualStep(step: unknown): step is ChecklistStepNumber {
  return typeof step === 'number' && MANUAL_CHECKLIST_STEPS.includes(step);
}

/** The checklist exists only for live website orders; own (courier-created) and cancelled orders have none. */
export function hasChecklist(order: ChecklistOrder): boolean {
  return order.website_order === true && order.own_order !== true && order.status !== 'cancelled';
}

export function isStepDone(order: ChecklistOrder, step: number): boolean {
  const definition = CHECKLIST_STEPS.find((item) => item.step === step);
  if (!definition) return false;
  if (definition.status) return definition.status.doneWhen.includes(order.status);
  return (order.checklist_steps ?? []).includes(step);
}

export function checklistProgress(order: ChecklistOrder): ChecklistProgress | null {
  if (!hasChecklist(order)) return null;
  const done = CHECKLIST_STEPS.filter((item) => isStepDone(order, item.step)).length;
  const next = CHECKLIST_STEPS.find((item) => !isStepDone(order, item.step)) ?? null;
  return { done, total: 8, next };
}

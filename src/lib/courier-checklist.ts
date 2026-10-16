import type { CourierOrder, CourierOrderStatus } from './api-v1/staff-types';

// Courier delivery checklist (v2, the owner's 7 steps). Internal to the courier: steps never become
// order statuses and are never shown on the customer tracking page. Steps 4, 5 and 7 are derived
// from the order status (Lambda refuses to store them). Step 3 is derived from the pharmacy answers
// (job 010): done when every item is answered by its pharmacy (`pharmacy_answers_complete`) or the
// order is already past «Новый». Steps 1, 2 and 6 are ticked by the courier and saved in RDS via Lambda.

export type ChecklistStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ChecklistStep = {
  step: ChecklistStepNumber;
  title: string;
  hint: string;
  /** For a status-linked step: the status move that completes it. */
  status?: { from: CourierOrderStatus; to: CourierOrderStatus; action: string; doneWhen: CourierOrderStatus[] };
  /** Derived from the pharmacy answers (step 3); never ticked by hand. */
  pharmacy?: { doneWhen: CourierOrderStatus[] };
};

export type ChecklistOrder = Pick<CourierOrder, 'status' | 'website_order' | 'checklist_steps'>
  & Partial<Pick<CourierOrder, 'own_order' | 'pharmacy_answers_complete'>>;

export type ChecklistProgress = { done: number; total: 7; next: ChecklistStep | null };

export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  { step: 1, title: 'Рассчитать доставку через Заза или Яндекс Карты', hint: 'Впишите сумму в поле «Мне за доставку».' },
  { step: 2, title: 'Передать список лекарств нужной аптеке', hint: 'Перешлите аптеке список товаров из заказа.' },
  { step: 3, title: 'Получить подтверждение наличия и цены', hint: 'Отмечается сам, когда аптеки ответят по каждому товару.',
    pharmacy: { doneWhen: ['confirmed', 'delivering', 'delivered'] } },
  { step: 4, title: 'Позвонить клиенту, сообщить итоговые суммы и согласовать оплату и время доставки', hint: 'Статус станет «Собирается».',
    status: { from: 'pending', to: 'confirmed', action: 'Согласовано', doneWhen: ['confirmed', 'delivering', 'delivered'] } },
  { step: 5, title: 'Забрать собранный заказ и выехать после подтверждения оплаты', hint: 'Статус станет «В пути».',
    status: { from: 'confirmed', to: 'delivering', action: 'Выехал', doneWhen: ['delivering', 'delivered'] } },
  { step: 6, title: 'Позвонить клиенту за 5–10 минут до прибытия', hint: 'Предупредите клиента, что скоро приедете.' },
  { step: 7, title: 'Передать заказ, кратко показать клиенту, как в следующий раз заказать через сайт, и завершить заказ', hint: 'Статус станет «Доставлен».',
    status: { from: 'delivering', to: 'delivered', action: 'Доставлен', doneWhen: ['delivered'] } },
];

export const MANUAL_CHECKLIST_STEPS: readonly number[] = CHECKLIST_STEPS
  .filter((item) => !item.status && !item.pharmacy).map((item) => item.step);

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
  // Old Lambda (no answer fields): not done while pending, done once the order moved on.
  if (definition.pharmacy) return order.pharmacy_answers_complete === true || definition.pharmacy.doneWhen.includes(order.status);
  return (order.checklist_steps ?? []).includes(step);
}

export function checklistProgress(order: ChecklistOrder): ChecklistProgress | null {
  if (!hasChecklist(order)) return null;
  const done = CHECKLIST_STEPS.filter((item) => isStepDone(order, item.step)).length;
  const next = CHECKLIST_STEPS.find((item) => !isStepDone(order, item.step)) ?? null;
  return { done, total: 7, next };
}

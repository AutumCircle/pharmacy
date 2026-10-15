import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECKLIST_STEPS, MANUAL_CHECKLIST_STEPS, checklistProgress, hasChecklist, isManualStep, isStepDone,
  type ChecklistOrder,
} from '../src/lib/courier-checklist.ts';

const order = (status: ChecklistOrder['status'], checklist_steps: number[] = [], extra: Partial<ChecklistOrder> = {}): ChecklistOrder =>
  ({ status, website_order: true, own_order: false, checklist_steps, ...extra });

test('there are the owner\'s 7 steps numbered 1-7 with exact titles', () => {
  assert.equal(CHECKLIST_STEPS.length, 7);
  assert.deepEqual(CHECKLIST_STEPS.map((item) => item.step), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(CHECKLIST_STEPS.map((item) => item.title), [
    'Рассчитать доставку через Заза или Яндекс Карты',
    'Передать список лекарств нужной аптеке',
    'Получить подтверждение наличия и цены',
    'Позвонить клиенту, сообщить итоговые суммы и согласовать оплату и время доставки',
    'Забрать собранный заказ и выехать после подтверждения оплаты',
    'Позвонить клиенту за 5–10 минут до прибытия',
    'Передать заказ, кратко показать клиенту, как в следующий раз заказать через сайт, и завершить заказ',
  ]);
  assert.ok(CHECKLIST_STEPS[5].title.includes('5–10'), 'step 6 uses an en dash');
  for (const item of CHECKLIST_STEPS) assert.match(item.hint, /[А-Яа-яЁё]/);
});

test('manual steps are 1, 2, 3 and 6', () => {
  assert.deepEqual([...MANUAL_CHECKLIST_STEPS], [1, 2, 3, 6]);
  for (const step of [1, 2, 3, 6]) assert.equal(isManualStep(step), true);
  for (const step of [4, 5, 7, 8, 0]) assert.equal(isManualStep(step), false);
  assert.equal(isManualStep('2'), false);
});

test('status-linked steps 4, 5 and 7 follow the order status, not stored checks', () => {
  const linked = CHECKLIST_STEPS.filter((item) => item.status)
    .map((item) => [item.step, item.status?.from, item.status?.to, item.status?.action, item.status?.doneWhen]);
  assert.deepEqual(linked, [
    [4, 'pending', 'confirmed', 'Согласовано', ['confirmed', 'delivering', 'delivered']],
    [5, 'confirmed', 'delivering', 'Выехал', ['delivering', 'delivered']],
    [7, 'delivering', 'delivered', 'Доставлен', ['delivered']],
  ]);
  assert.equal(CHECKLIST_STEPS[3].hint, 'Статус станет «Собирается».');
  const doneSteps = (status: ChecklistOrder['status']) => [4, 5, 7].filter((step) => isStepDone(order(status, [4, 5, 7]), step));
  assert.deepEqual(doneSteps('pending'), []);
  assert.deepEqual(doneSteps('confirmed'), [4]);
  assert.deepEqual(doneSteps('delivering'), [4, 5]);
  assert.deepEqual(doneSteps('delivered'), [4, 5, 7]);
  assert.equal(isStepDone(order('pending', [3]), 3), true);
  assert.equal(isStepDone(order('delivered', []), 6), false);
  assert.equal(isStepDone(order('pending', [8]), 8), false);
});

test('progress counts and next step match the acceptance criteria', () => {
  const pending = checklistProgress(order('pending', [1, 2]));
  assert.equal(pending?.done, 2);
  assert.equal(pending?.total, 7);
  assert.equal(pending?.next?.step, 3);

  const confirmed = checklistProgress(order('confirmed', []));
  assert.equal(confirmed?.done, 1);
  assert.equal(confirmed?.next?.step, 1);

  assert.equal(checklistProgress(order('delivering', []))?.done, 2);

  const delivered = checklistProgress(order('delivered', [1, 2, 3, 6]));
  assert.equal(delivered?.done, 7);
  assert.equal(delivered?.total, 7);
  assert.equal(delivered?.next, null);
});

test('cancelled and own orders have no checklist', () => {
  assert.equal(checklistProgress(order('cancelled', [1, 2])), null);
  assert.equal(hasChecklist(order('cancelled')), false);
  assert.equal(checklistProgress(order('pending', [], { website_order: false, own_order: true })), null);
  assert.equal(checklistProgress(order('pending', [], { website_order: false, own_order: false })), null);
  assert.equal(hasChecklist(order('pending')), true);
});

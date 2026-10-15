import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHECKLIST_STEPS, MANUAL_CHECKLIST_STEPS, checklistProgress, hasChecklist, isManualStep, isStepDone,
  type ChecklistOrder,
} from '../src/lib/courier-checklist.ts';

const order = (status: ChecklistOrder['status'], checklist_steps: number[] = [], extra: Partial<ChecklistOrder> = {}): ChecklistOrder =>
  ({ status, website_order: true, own_order: false, checklist_steps, ...extra });

test('there are 8 steps numbered 1-8 with Russian titles and hints', () => {
  assert.equal(CHECKLIST_STEPS.length, 8);
  assert.deepEqual(CHECKLIST_STEPS.map((item) => item.step), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const item of CHECKLIST_STEPS) {
    assert.match(item.title, /[А-Яа-яЁё]/);
    assert.match(item.hint, /[А-Яа-яЁё]/);
  }
  assert.deepEqual([...MANUAL_CHECKLIST_STEPS], [1, 2, 4, 5, 7]);
  assert.equal(isManualStep(2), true);
  assert.equal(isManualStep(3), false);
  assert.equal(isManualStep('2'), false);
});

test('status-linked steps 3, 6 and 8 follow the order status, not stored checks', () => {
  const linked = CHECKLIST_STEPS.filter((item) => item.status).map((item) => [item.step, item.status?.from, item.status?.to]);
  assert.deepEqual(linked, [[3, 'pending', 'confirmed'], [6, 'confirmed', 'delivering'], [8, 'delivering', 'delivered']]);
  const doneSteps = (status: ChecklistOrder['status']) => [3, 6, 8].filter((step) => isStepDone(order(status, [3, 6, 8]), step));
  assert.deepEqual(doneSteps('pending'), []);
  assert.deepEqual(doneSteps('confirmed'), [3]);
  assert.deepEqual(doneSteps('delivering'), [3, 6]);
  assert.deepEqual(doneSteps('delivered'), [3, 6, 8]);
  assert.equal(isStepDone(order('pending', [2]), 2), true);
  assert.equal(isStepDone(order('delivered', []), 2), false);
  assert.equal(isStepDone(order('pending', [9]), 9), false);
});

test('progress counts and next step match the acceptance criteria', () => {
  const pending = checklistProgress(order('pending', [1, 2]));
  assert.equal(pending?.done, 2);
  assert.equal(pending?.total, 8);
  assert.equal(pending?.next?.step, 3);

  const delivered = checklistProgress(order('delivered', [1, 2, 4, 5, 7]));
  assert.equal(delivered?.done, 8);
  assert.equal(delivered?.next, null);

  const delivering = checklistProgress(order('delivering', []));
  assert.equal(delivering?.done, 2);
  assert.equal(delivering?.next?.step, 1);

  assert.equal(checklistProgress(order('confirmed', [1, 2]))?.next?.step, 4);
});

test('cancelled and own orders have no checklist', () => {
  assert.equal(checklistProgress(order('cancelled', [1, 2])), null);
  assert.equal(hasChecklist(order('cancelled')), false);
  assert.equal(checklistProgress(order('pending', [], { website_order: false, own_order: true })), null);
  assert.equal(checklistProgress(order('pending', [], { website_order: false, own_order: false })), null);
  assert.equal(hasChecklist(order('pending')), true);
});

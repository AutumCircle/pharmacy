import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORDER_STAGES, ORDER_STAGE_LABELS, TRACKING_STEPS, isOrderStage, orderStage, orderStageLabel, statusStageLabel,
  trackingStepIndex,
} from '../src/lib/order-stage.ts';

test('every stage has its Russian label', () => {
  assert.deepEqual(ORDER_STAGES.map((stage) => ORDER_STAGE_LABELS[stage]),
    ['Собирается', 'Собран', 'Подтверждён', 'В пути', 'Доставлен', 'Отменён']);
  for (const stage of ORDER_STAGES) assert.equal(orderStageLabel({ stage, status: 'pending' }), ORDER_STAGE_LABELS[stage]);
  assert.equal(Object.values(ORDER_STAGE_LABELS).includes('В обработке'), false);
});

test('the Lambda stage wins over the status', () => {
  assert.equal(orderStage({ stage: 'assembled', status: 'pending' }), 'assembled');
  assert.equal(orderStageLabel({ stage: 'assembled', status: 'pending' }), 'Собран');
  assert.equal(orderStageLabel({ stage: 'assembling', status: 'pending' }), 'Собирается');
});

test('without a stage (old Lambda) the status is the fallback', () => {
  assert.equal(orderStageLabel({ status: 'pending' }), 'Собирается');
  assert.equal(orderStageLabel({ status: 'confirmed' }), 'Подтверждён');
  assert.equal(orderStageLabel({ status: 'delivering' }), 'В пути');
  assert.equal(orderStageLabel({ status: 'delivered' }), 'Доставлен');
  assert.equal(orderStageLabel({ status: 'cancelled' }), 'Отменён');
  // An unknown stage value is ignored, never shown.
  assert.equal(orderStageLabel({ stage: 'shipped', status: 'confirmed' }), 'Подтверждён');
  assert.equal(orderStageLabel({ stage: null, status: 'pending' }), 'Собирается');
  assert.equal(orderStageLabel({}), 'Собирается');
  assert.equal(isOrderStage('assembled'), true);
  assert.equal(isOrderStage('pending'), false);
  assert.equal(statusStageLabel('pending'), 'Собирается');
  assert.equal(statusStageLabel('confirmed'), 'Подтверждён');
});

test('tracking shows five steps and the current index', () => {
  assert.deepEqual(TRACKING_STEPS.map((stage) => ORDER_STAGE_LABELS[stage]),
    ['Собирается', 'Собран', 'Подтверждён', 'В пути', 'Доставлен']);
  assert.equal(trackingStepIndex({ stage: 'assembling', status: 'pending' }), 0);
  assert.equal(trackingStepIndex({ stage: 'assembled', status: 'pending' }), 1);
  assert.equal(trackingStepIndex({ stage: 'confirmed', status: 'confirmed' }), 2);
  assert.equal(trackingStepIndex({ stage: 'delivering', status: 'delivering' }), 3);
  assert.equal(trackingStepIndex({ stage: 'delivered', status: 'delivered' }), 4);
  assert.equal(trackingStepIndex({ stage: 'cancelled', status: 'cancelled' }), -1);
  // Old Lambda: «Собран» never appears, pending stays on the first step.
  assert.equal(trackingStepIndex({ status: 'pending' }), 0);
  assert.equal(trackingStepIndex({ status: 'confirmed' }), 2);
  assert.equal(trackingStepIndex({ status: 'cancelled' }), -1);
});

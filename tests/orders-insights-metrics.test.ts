import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRILL_METRICS,
  courierAveragePerDay,
  drillExplanation,
  parseDrillMetric,
} from '../src/app/admin/orders/insights-metrics.ts';

test('parseDrillMetric accepts only the allow-listed metrics', () => {
  assert.deepEqual([...DRILL_METRICS], ['ordered', 'delivered', 'average_check', 'profit', 'cancelled', 'clients']);
  for (const metric of DRILL_METRICS) assert.equal(parseDrillMetric(metric), metric);
  for (const value of ['', 'PROFIT', 'repeat_medicines', ' profit', 'profit ', 'toString', '__proto__', undefined, null, 7, ['profit']]) {
    assert.equal(parseDrillMetric(value), null, String(value));
  }
});

test('drillExplanation returns Russian copy for every metric', () => {
  for (const metric of DRILL_METRICS) {
    const text = drillExplanation(metric);
    assert.ok(text.length > 20, metric);
    assert.match(text, /[а-яё]/i, metric);
  }
  assert.match(drillExplanation('ordered'), /дате создания/);
  assert.match(drillExplanation('delivered'), /дате доставки/);
});

test('courierAveragePerDay averages over days with deliveries only', () => {
  assert.deepEqual(courierAveragePerDay([
    { courier_fee: 30 }, { courier_fee: 0 }, { courier_fee: 15 }, { courier_fee: '0.00' }, { courier_fee: 10 },
  ]), { average: 18.33, workingDays: 3 });
});

test('courierAveragePerDay returns 0 without division when there are no working days', () => {
  assert.deepEqual(courierAveragePerDay([{ courier_fee: 0 }, { courier_fee: '0' }, { courier_fee: null }]),
    { average: 0, workingDays: 0 });
  assert.deepEqual(courierAveragePerDay([]), { average: 0, workingDays: 0 });
});

test('courierAveragePerDay handles string decimals without float drift', () => {
  assert.deepEqual(courierAveragePerDay([{ courier_fee: '12.50' }, { courier_fee: '0.10' }, { courier_fee: '0.20' }]),
    { average: 4.27, workingDays: 3 });
  assert.deepEqual(courierAveragePerDay([{ courier_fee: '0.1' }, { courier_fee: '0.2' }]), { average: 0.15, workingDays: 2 });
  assert.deepEqual(courierAveragePerDay([{ courier_fee: 'abc' }, { courier_fee: '20.00' }]), { average: 20, workingDays: 1 });
});

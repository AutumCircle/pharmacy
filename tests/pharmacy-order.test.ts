import assert from 'node:assert/strict';
import test from 'node:test';

import { pharmacyOrderView, waitingLevel, waitingMinutes } from '../src/lib/pharmacy-order.ts';

const now = Date.parse('2026-10-16T10:00:00Z');

test('waitingMinutes floors to whole minutes', () => {
  assert.equal(waitingMinutes('2026-10-16T09:45:00Z', now), 15);
  assert.equal(waitingMinutes('2026-10-16T09:45:01+00:00', now), 14);
  assert.equal(waitingMinutes('2026-10-16T09:59:59.900Z', new Date(now)), 0);
});

test('waitingMinutes is never negative (clock skew)', () => {
  assert.equal(waitingMinutes('2026-10-16T10:05:00Z', now), 0);
});

test('waitingMinutes treats offset-less timestamps as UTC (parseOrderTime)', () => {
  assert.equal(waitingMinutes('2026-10-16T09:30:00', now), 30);
  assert.equal(waitingMinutes('2026-10-16T14:30:00+05:00', now), 30);
  assert.throws(() => waitingMinutes('not a date', now));
});

test('waitingLevel thresholds', () => {
  assert.equal(waitingLevel(0), 'normal');
  assert.equal(waitingLevel(9), 'normal');
  assert.equal(waitingLevel(10), 'warning');
  assert.equal(waitingLevel(19), 'warning');
  assert.equal(waitingLevel(20), 'urgent');
  assert.equal(waitingLevel(240), 'urgent');
});

test('pharmacyOrderView never carries client identity or client finance', () => {
  const leaky = {
    order_id: 'ord_x', order_reference: '3456-012', status: 'pending', created_at: '2026-10-16T09:00:00+00:00',
    waiting_since: '2026-10-16T09:00:00+00:00', awaiting_response: true,
    customer_name: 'SECRET-NAME', phone: 'SECRET-PHONE', address: 'SECRET-ADDRESS', landmark: 'SECRET-LANDMARK',
    order_total: '999.00', profit: '111.00', created_by_staff_account_id: 777,
    medicines: [{ medicine_name: 'NOW D3', quantity: 2, line_total: '888.00', base_unit_price: '50.00', base_line_total: '100.00' }],
    base_total: '100.00',
  };
  const view = pharmacyOrderView(leaky);
  const serialized = JSON.stringify(view);
  for (const secret of ['SECRET', '999', '111', '888', '777']) assert.ok(!serialized.includes(secret), secret);
  assert.equal(view.reference, '3456-012');
  assert.equal(view.status, 'pending');
  assert.equal(view.waitingSince, '2026-10-16T09:00:00+00:00');
  assert.equal(view.showPrices, true);
  assert.deepEqual(view.medicines, [{ name: 'NOW D3', quantity: 2, unitPrice: '50.00', lineTotal: '100.00' }]);
  assert.equal(view.total, '100.00');
});

test('pharmacyOrderView hides prices and badge for old Lambda responses or disabled policy', () => {
  const view = pharmacyOrderView({
    order_id: 'ord_y', status: 'confirmed', created_at: '2026-10-16T09:00:00',
    medicines: [{ medicine_name: 'A', quantity: 1, base_line_total: 5 }],
  });
  assert.equal(view.reference, 'ord_y');
  assert.equal(view.showPrices, false);
  assert.equal(view.medicines?.[0].unitPrice, null);
  assert.equal(view.medicines?.[0].lineTotal, null);
  assert.equal(view.total, null);
  assert.equal(view.waitingSince, null);
  assert.equal(pharmacyOrderView({ order_id: 'z', awaiting_response: false, waiting_since: '2026-10-16T09:00:00Z' }).waitingSince, null);
  assert.equal(pharmacyOrderView({ order_id: 'z' }).medicines, null);
});

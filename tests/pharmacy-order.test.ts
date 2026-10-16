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

test('pharmacyOrderView default policy response has no client data', () => {
  // Lambda defaults: client identity, client totals, profit and creator are OFF, so the keys are absent.
  const view = pharmacyOrderView({
    order_id: 'ord_x', order_reference: '3456-012', status: 'pending', created_at: '2026-10-16T09:00:00+00:00',
    waiting_since: '2026-10-16T09:00:00+00:00', awaiting_response: true,
    medicines: [{ medicine_name: 'NOW D3', quantity: 2, base_unit_price: '50.00', base_line_total: '100.00' }],
    base_total: '100.00',
  });
  assert.equal(view.reference, '3456-012');
  assert.equal(view.status, 'pending');
  assert.equal(view.waitingSince, '2026-10-16T09:00:00+00:00');
  assert.equal(view.showPrices, true);
  assert.equal(view.showClientPrices, false);
  assert.deepEqual(view.medicines, [{ name: 'NOW D3', quantity: 2, unitPrice: '50.00', lineTotal: '100.00', clientLineTotal: null }]);
  assert.equal(view.total, '100.00');
  for (const key of ['customerName', 'phone', 'address', 'landmark', 'clientTotal', 'profit', 'creator'] as const) {
    assert.equal(view[key], null, key);
  }
});

test('pharmacyOrderView shows client fields the owner turned ON in pharmacy_web', () => {
  const view = pharmacyOrderView({
    order_id: 'ord_x', order_reference: '3456-012', status: 'confirmed',
    customer_name: 'Алишер', phone: '+992 917 12 34 56', address: 'Айни 29', landmark: 'у рынка',
    order_total: '120.00', profit: '20.00', created_by_staff_account_id: null, source: 'Сайт',
    medicines: [{ medicine_name: 'NOW D3', quantity: 2, line_total: 120, base_unit_price: '50.00', base_line_total: '100.00' }],
    base_total: '100.00',
  });
  assert.equal(view.customerName, 'Алишер');
  assert.equal(view.phone, '+992 917 12 34 56');
  assert.equal(view.address, 'Айни 29');
  assert.equal(view.landmark, 'у рынка');
  assert.equal(view.clientTotal, '120.00');
  assert.equal(view.profit, '20.00');
  assert.equal(view.creator, 'Сайт');
  assert.equal(view.source, 'Сайт');
  assert.equal(view.showClientPrices, true);
  assert.equal(view.medicines?.[0].clientLineTotal, 120);
  assert.equal(pharmacyOrderView({ order_id: 'z', created_by_staff_account_id: 7 }).creator, 'Сотрудник 7');
});

test('pharmacyOrderView follows each field independently (partial policy)', () => {
  const view = pharmacyOrderView({ order_id: 'z', phone: '+992917123456', landmark: null, customer_name: '  ' });
  assert.equal(view.phone, '+992917123456');
  assert.equal(view.landmark, null);
  assert.equal(view.customerName, null);
  assert.equal(view.address, null);
  assert.equal(view.creator, null);
});

test('pharmacyOrderView keeps an empty medicines list distinct from a hidden one', () => {
  const empty = pharmacyOrderView({ order_id: 'z', medicines: [] });
  assert.deepEqual(empty.medicines, []);
  assert.equal(empty.showPrices, false);
  assert.equal(empty.showClientPrices, false);
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

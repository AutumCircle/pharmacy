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
  assert.deepEqual(view.medicines, [{ name: 'NOW D3', quantity: 2, unitPrice: '50.00', lineTotal: '100.00', clientLineTotal: null,
    orderItemId: null, myAnswer: null, myProblem: null, routedHere: false, collected: false, crossMark: null }]);
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

test('pharmacyOrderView exposes order_item_id and my_answer per item (job 010)', () => {
  const view = pharmacyOrderView({
    order_id: 'ord_x', status: 'pending', routed_away_count: 1,
    medicines: [
      { order_item_id: 81, medicine_name: 'A', quantity: 1, my_answer: 'available', my_problem: null },
      { order_item_id: 82, medicine_name: 'B', quantity: 2, my_answer: 'price_differs', my_problem: 'дороже на 5' },
      { order_item_id: 83, medicine_name: 'C', quantity: 1, my_answer: null, my_problem: null },
    ],
  });
  assert.equal(view.hasAnswers, true);
  assert.equal(view.canAnswer, true);
  assert.equal(view.routedAwayCount, 1);
  assert.deepEqual(view.medicines?.map((item) => [item.orderItemId, item.myAnswer, item.myProblem]), [
    [81, 'available', null], [82, 'price_differs', 'дороже на 5'], [83, null, null],
  ]);
  const confirmed = pharmacyOrderView({ order_id: 'ord_x', status: 'confirmed',
    medicines: [{ order_item_id: 81, medicine_name: 'A', my_answer: 'available' }] });
  assert.equal(confirmed.hasAnswers, true);
  assert.equal(confirmed.canAnswer, false, 'answers only while «Новый»');
});

test('pharmacyOrderView degrades to no actions on an old Lambda response', () => {
  const old = pharmacyOrderView({ order_id: 'ord_x', status: 'pending',
    medicines: [{ medicine_name: 'A', quantity: 1 }] });
  assert.equal(old.hasAnswers, false);
  assert.equal(old.canAnswer, false);
  assert.equal(old.routedAwayCount, 0);
  assert.equal(old.medicines?.[0].orderItemId, null);
  // One item without an id disables the controls for the whole card.
  const partial = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [
    { order_item_id: 81, medicine_name: 'A', my_answer: null }, { medicine_name: 'B' }] });
  assert.equal(partial.canAnswer, false);
  assert.equal(pharmacyOrderView({ order_id: 'z', status: 'pending', medicines: [] }).canAnswer, false);
  assert.equal(pharmacyOrderView({ order_id: 'z', status: 'pending' }).canAnswer, false);
  const bogus = pharmacyOrderView({ order_id: 'z', status: 'pending',
    medicines: [{ order_item_id: 81, medicine_name: 'A', my_answer: 'maybe' }] });
  assert.equal(bogus.medicines?.[0].myAnswer, null);
});

test('pharmacyOrderView exposes assembly_state and assembly_available (job 011)', () => {
  const base = { order_id: 'ord_x', status: 'confirmed', medicines: [{ order_item_id: 81, medicine_name: 'A', my_answer: 'available' }] };
  const waiting = pharmacyOrderView({ ...base, assembly_state: null, assembly_available: true });
  assert.equal(waiting.assemblyAvailable, true);
  assert.equal(waiting.assemblyState, null);
  assert.deepEqual(waiting.assemblyAction, { state: 'assembling', label: 'Начать сборку' });
  const assembling = pharmacyOrderView({ ...base, assembly_state: 'assembling', assembly_available: true });
  assert.equal(assembling.assemblyState, 'assembling');
  assert.deepEqual(assembling.assemblyAction, { state: 'assembled', label: 'Сборка сделана' });
  const assembled = pharmacyOrderView({ ...base, assembly_state: 'assembled', assembly_available: true });
  assert.equal(assembled.assemblyState, 'assembled');
  assert.equal(assembled.assemblyAction, null);
  const nothing = pharmacyOrderView({ ...base, assembly_state: null, assembly_available: false });
  assert.equal(nothing.assemblyAvailable, false);
  assert.equal(nothing.assemblyAction, null);
  // Assembly does not depend on the status field, which the pharmacy_web policy may hide.
  const hiddenStatus = pharmacyOrderView({ order_id: 'ord_x', assembly_state: null, assembly_available: true });
  assert.equal(hiddenStatus.status, null);
  assert.equal(hiddenStatus.assemblyAvailable, true);
});

test('pharmacyOrderView degrades to no assembly actions without the job 011 fields', () => {
  const old = pharmacyOrderView({ order_id: 'ord_x', status: 'confirmed', medicines: [{ medicine_name: 'A' }] });
  assert.equal(old.assemblyAvailable, false);
  assert.equal(old.assemblyState, null);
  assert.equal(old.assemblyAction, null);
  const bogus = pharmacyOrderView({ order_id: 'ord_x', status: 'confirmed', assembly_state: 'done', assembly_available: true });
  assert.equal(bogus.assemblyState, null);
});

test('pharmacyOrderView: routed items, owner colours and part controls (rework 1)', () => {
  const two = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', assembly_available: true, assembly_state: null,
    medicines: [
      { order_item_id: 82, medicine_name: 'B', my_answer: 'available', routed_here: true, collected: true },
      { order_item_id: 83, medicine_name: 'C', my_answer: 'unavailable', routed_here: true, collected: false },
      { order_item_id: 84, medicine_name: 'D', my_answer: null, routed_here: true },
    ] });
  assert.deepEqual(two.medicines?.map((item) => [item.routedHere, item.collected, item.crossMark?.text ?? null]), [
    [true, true, 'В аптеке 2'], [true, false, 'Нет в наличии в обеих аптеках'], [true, false, null]]);
  assert.equal(two.medicines?.[0].crossMark?.tone, 'orange');
  assert.equal(two.medicines?.[1].crossMark?.tone, 'bad');
  assert.equal(two.partControls, false, 'only routed items: per-item controls instead of the part buttons');

  const one = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', assembly_available: true,
    medicines: [{ order_item_id: 81, medicine_name: 'A', my_answer: 'available' }],
    routed_away_count: 3,
    routed_away: [
      { order_item_id: 82, medicine_name: 'B', quantity: 1, pharmacy_id: 2, answer: 'available' },
      { order_item_id: 83, medicine_name: 'C', pharmacy_id: 2, answer: 'unavailable' },
      { order_item_id: 84, medicine_name: 'D', pharmacy_id: 2, answer: null },
    ] });
  assert.equal(one.partControls, true);
  assert.equal(one.medicines?.[0].crossMark, null);
  assert.deepEqual(one.routedAway, [
    { name: 'B', quantity: 1, text: 'В аптеке 2', tone: 'orange' },
    { name: 'C', quantity: null, text: 'Нет в наличии в обеих аптеках', tone: 'bad' },
    { name: 'D', quantity: null, text: 'Ждём ответ Ватан 2', tone: 'wait' }]);
  // Old Lambda: no routed fields.
  const old = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [{ medicine_name: 'A' }] });
  assert.deepEqual(old.routedAway, []);
  assert.equal(old.partControls, false);
});

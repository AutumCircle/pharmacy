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
  assert.deepEqual(waiting.assemblyAction, { state: 'assembled', label: 'Собран' });
  const assembling = pharmacyOrderView({ ...base, assembly_state: 'assembling', assembly_available: true });
  assert.equal(assembling.assemblyState, 'assembling');
  assert.deepEqual(assembling.assemblyAction, { state: 'assembled', label: 'Собран' });
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
  assert.equal(two.partControls, true, 'job 015: one «Собран» also for an all-routed «Ватан 2»');

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
  // Job 013: routed items are rows of the same table (see the job 013 tests below).
  assert.deepEqual(one.rows?.filter((row) => row.kind === 'routed').map((row) => row.chip),
    [{ text: 'Ватан 2', tone: 'orange' }, { text: 'Нет в наличии в обеих аптеках', tone: 'bad' },
      { text: 'Ватан 2', tone: 'orange' }]);
  // Old Lambda: no routed fields.
  const old = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [{ medicine_name: 'A' }] });
  assert.deepEqual(old.rows?.map((row) => row.kind), ['own']);
  assert.equal(old.partControls, false);
});

test('job 013: routed rows merge into the «Ватан 1» table in order_item_id order', () => {
  const view = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', stage: 'assembling',
    medicines: [
      { order_item_id: 81, medicine_name: 'A', quantity: 1, base_unit_price: '10.00', base_line_total: '10.00',
        my_answer: 'available' },
      { order_item_id: 84, medicine_name: 'D', quantity: 2, base_unit_price: '5.00', base_line_total: '10.00',
        my_answer: null },
    ],
    routed_away_count: 2,
    routed_away: [
      { order_item_id: 83, medicine_name: 'C', quantity: 1, pharmacy_id: 2, answer: 'unavailable' },
      { order_item_id: 82, medicine_name: 'B', quantity: 3, pharmacy_id: 2, answer: null },
    ] });
  assert.deepEqual(view.rows?.map((row) => [row.orderItemId, row.kind, row.name, row.chip?.text, row.chip?.tone, row.canAct]), [
    [81, 'own', 'A', 'В наличии', 'ok', true],
    [82, 'routed', 'B', 'Ватан 2', 'orange', false],
    [83, 'routed', 'C', 'Нет в наличии в обеих аптеках', 'bad', false],
    [84, 'own', 'D', 'Ждёт ответа', 'wait', true],
  ]);
  const routed = view.rows?.find((row) => row.orderItemId === 82);
  assert.equal(routed?.hint, 'Ждёт ответа Ватан 2');
  assert.equal(view.rows?.find((row) => row.orderItemId === 83)?.hint, null);
  assert.equal(view.rows?.find((row) => row.orderItemId === 81)?.hint, null);
  assert.equal(routed?.unitPrice, null);
  assert.equal(routed?.quantity, 3);
  assert.equal(view.answerColumn, true);
  assert.equal(view.routedAwayCount, 2);
  assert.equal(view.stageLabel, 'Собирается');
  // «Ватан 2» answering «available» or «price_differs» keeps the orange «Ватан 2» chip.
  const priced = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [],
    routed_away: [{ order_item_id: 82, medicine_name: 'B', pharmacy_id: 2, answer: 'price_differs' },
      { order_item_id: 83, medicine_name: 'C', pharmacy_id: 2, answer: 'available' }] });
  assert.deepEqual(priced.rows?.map((row) => row.chip?.text), ['Ватан 2', 'Ватан 2']);
});

test('job 013: row controls only on own rows of a pending order with answer fields', () => {
  const base = { order_id: 'ord_x', medicines: [
    { order_item_id: 81, medicine_name: 'A', my_answer: null },
    { order_item_id: 82, medicine_name: 'B', my_answer: 'available', routed_here: true },
  ] };
  const pending = pharmacyOrderView({ ...base, status: 'pending' });
  // Job 014: routed-here items get the same row controls (no separate «Ватан 2» list).
  assert.deepEqual(pending.rows?.map((row) => row.canAct), [true, true]);
  const confirmed = pharmacyOrderView({ ...base, status: 'confirmed', stage: 'confirmed' });
  assert.deepEqual(confirmed.rows?.map((row) => row.canAct), [false, false]);
  assert.equal(confirmed.stageLabel, 'Подтверждён');
  assert.equal(pharmacyOrderView({ ...base, status: 'pending', stage: 'assembled' }).stageLabel, 'Собран');
  assert.equal(pharmacyOrderView({ ...base, status: 'pending' }).stageLabel, 'Собирается');
  // Old Lambda (no order_item_id): no controls and no answer chips.
  const old = pharmacyOrderView({ order_id: 'ord_x', status: 'pending',
    medicines: [{ medicine_name: 'A', quantity: 1 }, { medicine_name: 'B' }] });
  assert.deepEqual(old.rows?.map((row) => [row.canAct, row.chip, row.orderItemId]), [[false, null, null], [false, null, null]]);
  assert.equal(old.answerColumn, false);
  // Items hidden by the policy: no rows at all, even with routed entries.
  assert.equal(pharmacyOrderView({ order_id: 'ord_x', status: 'pending',
    routed_away: [{ order_item_id: 82, medicine_name: 'B', pharmacy_id: 2, answer: null }] }).rows, null);
  // Status hidden by the policy: no stage chip.
  assert.equal(pharmacyOrderView({ order_id: 'ord_x', stage: 'assembled' }).stageLabel, null);
});

// --- job 014: one compact format for «Ватан 1» and «Ватан 2» -----------------------------------------

const rowShape = (row: { kind: string; canAct: boolean; canEditPrice: boolean; canCollect: boolean;
  chip: { text: string; tone: string } | null; unitPrice: unknown; lineTotal: unknown }) =>
  [row.kind, row.canAct, row.canEditPrice, row.canCollect, row.chip?.text ?? null, row.unitPrice, row.lineTotal];

test('job 014: the same row view for «Ватан 1» and «Ватан 2»', () => {
  const medicines = [
    { order_item_id: 81, medicine_name: 'A', quantity: 1, base_unit_price: '10.00', base_line_total: '10.00', my_answer: null },
    { order_item_id: 82, medicine_name: 'B', quantity: 2, base_unit_price: '5.00', base_line_total: '10.00',
      my_answer: 'available' },
  ];
  const one = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines }, 1);
  const two = pharmacyOrderView({ order_id: 'ord_x', status: 'pending',
    medicines: medicines.map((item) => ({ ...item, routed_here: false })) }, 2);
  assert.deepEqual(one.rows?.map(rowShape), two.rows?.map(rowShape));
  assert.deepEqual(one.rows?.map(rowShape), [
    ['own', true, true, false, 'Ждёт ответа', '10.00', '10.00'],
    ['own', true, true, false, 'В наличии', '5.00', '10.00'],
  ]);
  assert.equal(one.actionColumn, true);
  assert.equal(two.actionColumn, true);
});

test('job 015: «Ватан 2» routed items are table rows with «Нет в наличии» and price edit, no «Собрано»', () => {
  const view = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', assembly_available: true,
    medicines: [
      { order_item_id: 82, medicine_name: 'B', quantity: 1, base_unit_price: '20.00', base_line_total: '20.00',
        my_answer: null, routed_here: true },
      { order_item_id: 83, medicine_name: 'C', quantity: 1, base_unit_price: '30.00', base_line_total: '30.00',
        my_answer: 'available', routed_here: true },
      { order_item_id: 84, medicine_name: 'D', quantity: 1, base_unit_price: '40.00', base_line_total: '40.00',
        my_answer: 'available', routed_here: true, collected: true },
      { order_item_id: 85, medicine_name: 'E', quantity: 1, base_unit_price: '50.00', base_line_total: '50.00',
        my_answer: 'unavailable', routed_here: true },
    ] }, 2);
  assert.deepEqual(view.rows?.map((row) => [row.orderItemId, row.canAct, row.canEditPrice, row.canCollect, row.chip?.text]), [
    [82, true, true, false, 'Ждёт ответа'],
    [83, true, true, false, 'В аптеке 2'],
    // Collected earlier (old per-item «Собрано»): final, no controls, the chip stays.
    [84, false, false, false, 'В аптеке 2'],
    // «Нет в наличии»: no price editor; the (disabled, selected) «Нет в наличии» stays.
    [85, true, false, false, 'Нет в наличии в обеих аптеках'],
  ]);
  assert.equal(view.rows?.find((row) => row.orderItemId === 85)?.chip?.tone, 'bad');
  assert.equal(view.rows?.find((row) => row.orderItemId === 84)?.collected, true);
  assert.equal(view.partControls, true, 'one «Собран» under the table, also when every item came routed');
  assert.deepEqual(view.assemblyAction, { state: 'assembled', label: 'Собран' });
});

test('job 014: «Нет в наличии» at «Ватан 2» is «нет в обеих аптеках» and both pharmacies confirm it', () => {
  const own = { order_id: 'ord_x', status: 'pending', medicines: [
    { order_item_id: 81, medicine_name: 'A', my_answer: 'unavailable' }] };
  assert.deepEqual(pharmacyOrderView(own, 2).rows?.[0].chip, { text: 'Нет в наличии в обеих аптеках', tone: 'bad' });
  assert.deepEqual(pharmacyOrderView(own, 1).rows?.[0].chip, { text: 'Нет в наличии', tone: 'bad' });
  assert.equal(pharmacyOrderView(own, 1).unavailableConfirm, 'Передать в Ватан 2?');
  assert.equal(pharmacyOrderView(own, 2).unavailableConfirm, 'Нет в обеих аптеках?');
});

test('job 014: no price editor when the policy hides prices, no answer controls once confirmed', () => {
  const hidden = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [
    { order_item_id: 81, medicine_name: 'A', quantity: 1, my_answer: null }] }, 1);
  assert.equal(hidden.showPrices, false);
  assert.deepEqual(hidden.rows?.map((row) => [row.canAct, row.canEditPrice]), [[true, false]]);
  const confirmed = pharmacyOrderView({ order_id: 'ord_x', status: 'confirmed', medicines: [
    { order_item_id: 81, medicine_name: 'A', quantity: 1, base_unit_price: '1.00', base_line_total: '1.00', my_answer: 'available' },
    { order_item_id: 82, medicine_name: 'B', quantity: 1, base_unit_price: '1.00', base_line_total: '1.00', my_answer: 'available',
      routed_here: true }] }, 2);
  assert.deepEqual(confirmed.rows?.map((row) => [row.canAct, row.canEditPrice, row.canCollect]),
    [[false, false, false], [false, false, false]]);
  assert.equal(confirmed.actionColumn, false);
  // Routed-away rows at «Ватан 1» stay read-only.
  const routedAway = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [],
    routed_away: [{ order_item_id: 82, medicine_name: 'B', pharmacy_id: 2, answer: null }] }, 1);
  assert.deepEqual(routedAway.rows?.map((row) => [row.kind, row.canAct, row.canEditPrice, row.canCollect]),
    [['routed', false, false, false]]);
  assert.equal(routedAway.actionColumn, false);
});

// --- job 015: «Нет в наличии» + price per row, one «Собран» ------------------------------------------

test('job 015: both pharmacies get the same two row controls and no «Собрано»', () => {
  const medicines = [
    { order_item_id: 81, medicine_name: 'A', quantity: 1, base_unit_price: '10.00', base_line_total: '10.00', my_answer: null },
    { order_item_id: 82, medicine_name: 'B', quantity: 2, base_unit_price: '5.00', base_line_total: '10.00',
      my_answer: 'available', routed_here: true },
  ];
  const rows = [1, 2].map((id) => pharmacyOrderView({ order_id: 'ord_x', status: 'pending', assembly_available: true,
    assembly_state: null, medicines }, id));
  for (const view of rows) {
    assert.deepEqual(view.rows?.map((row) => [row.canAct, row.canEditPrice, row.canCollect]),
      [[true, true, false], [true, true, false]]);
    assert.equal(view.actionColumn, true);
    assert.equal(view.partControls, true);
    assert.deepEqual(view.assemblyAction, { state: 'assembled', label: 'Собран' });
  }
  // Price hidden by the policy: only «Нет в наличии».
  const hidden = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', medicines: [
    { order_item_id: 81, medicine_name: 'A', quantity: 1, my_answer: null }] }, 2);
  assert.deepEqual(hidden.rows?.map((row) => [row.canAct, row.canEditPrice]), [[true, false]]);
});

test('job 015: after «Собран» no row has controls; the chip stays', () => {
  for (const id of [1, 2]) {
    const view = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', assembly_available: true,
      assembly_state: 'assembled', medicines: [
        { order_item_id: 81, medicine_name: 'A', quantity: 1, base_unit_price: '10.00', base_line_total: '10.00',
          my_answer: 'available' },
        { order_item_id: 82, medicine_name: 'B', quantity: 1, base_unit_price: '10.00', base_line_total: '10.00',
          my_answer: 'unavailable' }],
      routed_away: [{ order_item_id: 83, medicine_name: 'C', pharmacy_id: 2, answer: null }] }, id);
    assert.ok(view.rows?.every((row) => !row.canAct && !row.canEditPrice && !row.canCollect));
    assert.equal(view.actionColumn, false);
    assert.equal(view.assemblyAction, null);
    assert.equal(view.partControls, true, 'the footer still shows the «Собран» chip');
    assert.equal(view.rows?.find((row) => row.kind === 'routed')?.chip?.text, 'Ватан 2');
  }
  // Reopened «Ватан 2» (job 014): «Собирается» -> controls and «Собран» again.
  const reopened = pharmacyOrderView({ order_id: 'ord_x', status: 'pending', assembly_available: true,
    assembly_state: 'assembling', medicines: [
      { order_item_id: 81, medicine_name: 'A', my_answer: null, routed_here: true }] }, 2);
  assert.deepEqual(reopened.rows?.map((row) => row.canAct), [true]);
  assert.deepEqual(reopened.assemblyAction, { state: 'assembled', label: 'Собран' });
});

test('job 015: the pharmacy panel has no «В наличии», «Собрано», «Начать сборку» or «Сборка сделана» control', async () => {
  const { readFile } = await import('node:fs/promises');
  const names = ['PharmacyItemRow.tsx', 'PharmacyAssemblyButtons.tsx', 'PharmacyOrderCard.tsx', 'PharmacyAlertBanner.tsx'];
  const files = await Promise.all(names.map((name) =>
    readFile(new URL(`../src/app/staff/orders/${name}`, import.meta.url), 'utf8')));
  const source = files.join('\n');
  assert.doesNotMatch(source, /ROW_ACTION_LABELS\.(available|collect)/);
  assert.doesNotMatch(source, /Начать сборку|Сборка сделана/);
  assert.doesNotMatch(source, /assembly\/items/);
  // The one «Собран» posts {state: 'assembled'} to the existing assembly route.
  const buttons = files[1];
  assert.match(buttons, /\/api\/staff\/orders\/\$\{encodeURIComponent\(orderId\)\}\/assembly`/);
  assert.match(buttons, /validateAssemblyRequest\(\{ state: target \}\)/);
});

test('job 014 round 2: row controls are at least 44 px on phones and touch screens', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/app/staff/staff.css', import.meta.url), 'utf8');
  const start = css.indexOf('@media (max-width: 640px), (pointer: coarse) {');
  assert.ok(start >= 0, 'coarse-pointer / narrow-screen rule exists');
  const block = css.slice(start, css.indexOf('\n}', start));
  assert.match(block, /\.pa-mini, \.pa-price-tap, \.pa-price-inline input \{ min-height: 44px; \}/);
  assert.match(block, /\.pa-price-inline \.pa-mini \{ min-width: 44px; \}/);
  assert.match(css, /@media \(max-width: 420px\) \{ \.pa-mini-group \{ max-width: 200px; \} \}/);
});

test('an older website order shows the bracketed landmark separately; a stored landmark wins', () => {
  const legacy = pharmacyOrderView({ order_id: 'old', address: 'Такси Худжанд (Отправка кардан даркор)', landmark: null });
  assert.equal(legacy.address, 'Такси Худжанд');
  assert.equal(legacy.landmark, 'Отправка кардан даркор');
  const current = pharmacyOrderView({ order_id: 'new', address: 'Айни 29 (2 этаж)', landmark: 'у рынка' });
  assert.equal(current.address, 'Айни 29 (2 этаж)');
  assert.equal(current.landmark, 'у рынка');
});

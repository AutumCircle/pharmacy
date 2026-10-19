import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSEMBLY_LABELS, ASSEMBLY_NOT_COMPLETE, ASSEMBLY_WARNING, assemblyChip, assemblyWarning, confirmBlockedReason,
  courierAssemblyLines, courierAssemblySummary, nextAssemblyAction, validateAssemblyRequest, validateItemCollectRequest,
} from '../src/lib/pharmacy-assembly.ts';

const mark = (pharmacy_id: 1 | 2, state: 'waiting' | 'assembling' | 'assembled') =>
  ({ pharmacy_id, state, started_at: null, assembled_at: null });

test('request validation accepts exactly {state} with a known state', () => {
  assert.deepEqual(validateAssemblyRequest({ state: 'assembling' }), { ok: true, value: { state: 'assembling' } });
  assert.deepEqual(validateAssemblyRequest({ state: 'assembled' }), { ok: true, value: { state: 'assembled' } });
});

test('request validation rejects everything else, including a pharmacy id', () => {
  const bad: unknown[] = [null, undefined, 'assembled', [], ['assembled'], {}, { state: 'waiting' }, { state: '' },
    { state: null }, { state: 1 }, { state: 'ASSEMBLED' }, { state: 'assembled', pharmacy_id: 2 },
    { pharmacy_id: 1 }, { state: 'assembling', extra: true }];
  for (const body of bad) {
    const result = validateAssemblyRequest(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    if (!result.ok) assert.equal(result.error, 'Укажите отметку сборки');
  }
});

test('labels are Russian', () => {
  assert.deepEqual(ASSEMBLY_LABELS, { waiting: 'Ждёт сборки', assembling: 'Собирается', assembled: 'Собран' });
  assert.deepEqual(assemblyChip(null), { text: 'Ждёт сборки', tone: 'wait' });
  assert.deepEqual(assemblyChip('assembling'), { text: 'Собирается', tone: 'warn' });
  assert.deepEqual(assemblyChip('assembled'), { text: 'Собран', tone: 'ok' });
});

test('nextAssemblyAction for every state', () => {
  assert.deepEqual(nextAssemblyAction({ assembly_available: true, assembly_state: null }),
    { state: 'assembling', label: 'Начать сборку' });
  assert.deepEqual(nextAssemblyAction({ assembly_available: true }), { state: 'assembling', label: 'Начать сборку' });
  assert.deepEqual(nextAssemblyAction({ assembly_available: true, assembly_state: 'assembling' }),
    { state: 'assembled', label: 'Сборка сделана' });
  assert.equal(nextAssemblyAction({ assembly_available: true, assembly_state: 'assembled' }), null);
  // Not offered by Lambda (pending order, nothing to assemble) or an old Lambda without the field.
  assert.equal(nextAssemblyAction({ assembly_available: false, assembly_state: null }), null);
  assert.equal(nextAssemblyAction({ assembly_available: false, assembly_state: 'assembling' }), null);
  assert.equal(nextAssemblyAction({}), null);
});

test('courierAssemblyLines: one line per pharmacy, sorted by pharmacy id', () => {
  const lines = courierAssemblyLines({ status: 'confirmed', assembly: [mark(2, 'assembling'), mark(1, 'assembled')] });
  assert.deepEqual(lines.map((line) => line.text), ['Ватан 1: собран', 'Ватан 2: собирается']);
  assert.deepEqual(lines.map((line) => line.state), ['assembled', 'assembling']);
  assert.deepEqual(courierAssemblyLines({ assembly: [mark(2, 'waiting')] }).map((line) => line.text),
    ['Ватан 2: ждёт сборки']);
  assert.equal(courierAssemblySummary({ assembly: [mark(1, 'assembled'), mark(2, 'waiting')] }),
    'Ватан 1: собран · Ватан 2: ждёт сборки');
});

test('courierAssemblyLines: nothing for old Lambda or courier-created orders', () => {
  assert.deepEqual(courierAssemblyLines({ status: 'confirmed' }), []);
  assert.deepEqual(courierAssemblyLines({ status: 'confirmed', assembly: null }), []);
  assert.deepEqual(courierAssemblyLines({ status: 'confirmed', assembly: [] }), []);
  assert.equal(courierAssemblySummary({ status: 'confirmed' }), null);
});

test('assemblyWarning: only for confirmed and incomplete', () => {
  const incomplete = { status: 'confirmed', assembly: [mark(1, 'assembled'), mark(2, 'waiting')], assembly_complete: false };
  assert.equal(assemblyWarning(incomplete), ASSEMBLY_WARNING);
  assert.equal(ASSEMBLY_WARNING, 'Не все аптеки отметили «Собран»');
  assert.equal(assemblyWarning({ ...incomplete, assembly_complete: true }), null);
  for (const status of ['pending', 'delivering', 'delivered', 'cancelled']) {
    assert.equal(assemblyWarning({ ...incomplete, status }), null, status);
  }
});

test('assemblyWarning: absent for an old Lambda payload', () => {
  assert.equal(assemblyWarning({ status: 'confirmed' }), null);
  assert.equal(assemblyWarning({ status: 'confirmed', assembly_complete: false }), null);
  assert.equal(assemblyWarning({ status: 'confirmed', assembly: [mark(1, 'waiting')] }), null);
});

test('validateItemCollectRequest mirrors Lambda (rework 1)', () => {
  assert.deepEqual(validateItemCollectRequest({ order_item_id: 82 }), { ok: true, value: { order_item_id: 82 } });
  for (const body of [null, {}, [82], { order_item_id: '82' }, { order_item_id: 0 }, { order_item_id: 1.5 },
    { order_item_id: 82, pharmacy_id: 2 }, { order_item_id: 82, collected: true }]) {
    assert.equal(validateItemCollectRequest(body).ok, false, JSON.stringify(body));
  }
});

test('confirmBlockedReason: «Согласовано» waits for every pharmacy (rework 1)', () => {
  const pending = { status: 'pending', website_order: true, assembly: [mark(1, 'assembled'), mark(2, 'assembling')] };
  assert.equal(confirmBlockedReason({ ...pending, assembly_complete: false }), ASSEMBLY_NOT_COMPLETE);
  assert.equal(ASSEMBLY_NOT_COMPLETE, 'Сначала все аптеки должны отметить «Сборка сделана»');
  assert.equal(confirmBlockedReason({ ...pending, assembly_complete: true }), null);
  // Nothing to assemble (all unavailable) or courier-created: Lambda returns [] and complete = true.
  assert.equal(confirmBlockedReason({ status: 'pending', website_order: true, assembly: [], assembly_complete: true }), null);
  assert.equal(confirmBlockedReason({ ...pending, website_order: false, assembly_complete: false }), null);
  assert.equal(confirmBlockedReason({ ...pending, status: 'confirmed', assembly_complete: false }), null);
  // Old Lambda without the fields: never blocked in the UI.
  assert.equal(confirmBlockedReason({ status: 'pending', website_order: true }), null);
});

test('step 5 warning is only for confirmed orders, not for pending ones (rework 1)', () => {
  const incomplete = { assembly: [mark(1, 'assembling')], assembly_complete: false };
  assert.equal(assemblyWarning({ ...incomplete, status: 'pending' }), null);
  assert.equal(assemblyWarning({ ...incomplete, status: 'confirmed' }), ASSEMBLY_WARNING);
});

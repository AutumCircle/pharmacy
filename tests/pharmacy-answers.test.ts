import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHARMACY_ANSWER_LABELS, answersProgressText, confirmedAmountText, courierItemAnswerLabel, courierItemAnswerTone,
  crossPharmacyMark, normalizePharmacyPrice,
  isAmountConfirmed, pharmacyAnswerChip, validatePharmacyAnswersRequest,
  ROW_ACTION_LABELS, forwardChangeNotification, routedAwayMark, rowActionRequest,
} from '../src/lib/pharmacy-answers.ts';

const at = '2026-10-16T09:00:00+00:00';
const answer = (pharmacy_id: 1 | 2, value: 'available' | 'unavailable' | 'price_differs', problem: string | null = null) =>
  ({ pharmacy_id, answer: value, problem, answered_at: at });

test('request validation accepts the Lambda contract and normalizes the problem text', () => {
  const result = validatePharmacyAnswersRequest({ answers: [
    { order_item_id: 1, answer: 'available' },
    { order_item_id: 2, answer: 'unavailable' },
    { order_item_id: 3, answer: 'unavailable', problem: '  закончился  ' },
    { order_item_id: 4, answer: 'price_differs', problem: 'дороже   на 5' },
    { order_item_id: 5, answer: 'available', problem: null },
    { order_item_id: 6, answer: 'unavailable', problem: '' },
  ] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, { answers: [
    { order_item_id: 1, answer: 'available' },
    { order_item_id: 2, answer: 'unavailable' },
    { order_item_id: 3, answer: 'unavailable', problem: 'закончился' },
    { order_item_id: 4, answer: 'price_differs', problem: 'дороже на 5' },
    { order_item_id: 5, answer: 'available' },
    { order_item_id: 6, answer: 'unavailable' },
  ] });
  const fifty = { answers: Array.from({ length: 50 }, (_, index) => ({ order_item_id: index + 1, answer: 'available' })) };
  assert.equal(validatePharmacyAnswersRequest(fifty).ok, true);
  assert.equal(validatePharmacyAnswersRequest({ answers: [
    { order_item_id: 1, answer: 'price_differs', problem: 'x'.repeat(300) }] }).ok, true);
});

test('request validation mirrors Lambda rejections', () => {
  const bad: unknown[] = [
    null, [], 'x', {}, { answers: [] }, { answers: 'x' },
    { answers: Array.from({ length: 51 }, (_, index) => ({ order_item_id: index + 1, answer: 'available' })) },
    { answers: [{ order_item_id: 1, answer: 'available' }], pharmacy_id: 2 },
    { answers: [{ order_item_id: 1, answer: 'available', pharmacy_id: 2 }] },
    { answers: [{ order_item_id: 1, answer: 'available', price: '10' }] },
    { answers: [{ order_item_id: 1, answer: 'price_differs', problem: 'дороже', unit_price: '12' }] },
    { answers: [{ order_item_id: 1 }] },
    { answers: [{ answer: 'available' }] },
    { answers: [{ order_item_id: '1', answer: 'available' }] },
    { answers: [{ order_item_id: 1.5, answer: 'available' }] },
    { answers: [{ order_item_id: 0, answer: 'available' }] },
    { answers: [{ order_item_id: 1, answer: 'maybe' }] },
    { answers: [{ order_item_id: 1, answer: 'available' }, { order_item_id: 1, answer: 'unavailable' }] },
    { answers: [{ order_item_id: 1, answer: 'price_differs' }] },
    { answers: [{ order_item_id: 1, answer: 'price_differs', problem: '   ' }] },
    { answers: [{ order_item_id: 1, answer: 'price_differs', problem: 'ab' }] },
    { answers: [{ order_item_id: 1, answer: 'price_differs', problem: 'x'.repeat(301) }] },
    { answers: [{ order_item_id: 1, answer: 'price_differs', problem: 12 }] },
    { answers: [{ order_item_id: 1, answer: 'available', problem: 'всё хорошо' }] },
    { answers: [{ order_item_id: 1, answer: 'available', problem: '' }] },
    { answers: [{ order_item_id: 1, answer: 'unavailable', problem: 'ab' }] },
  ];
  for (const body of bad) {
    const result = validatePharmacyAnswersRequest(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.match(result.ok ? '' : result.error, /[А-Яа-яЁё]/);
  }
});

test('labels and chips are Russian', () => {
  assert.deepEqual(PHARMACY_ANSWER_LABELS, {
    available: 'В наличии, цена верна', unavailable: 'Нет в наличии', price_differs: 'Цена отличается',
  });
  assert.deepEqual(pharmacyAnswerChip('available'), { text: 'В наличии', tone: 'ok' });
  assert.deepEqual(pharmacyAnswerChip('unavailable'), { text: 'Нет в наличии', tone: 'bad' });
  assert.deepEqual(pharmacyAnswerChip('price_differs'), { text: 'Цена отличается', tone: 'warn' });
  assert.deepEqual(pharmacyAnswerChip(null), { text: 'Ждёт ответа', tone: 'wait' });
});

test('courierItemAnswerLabel covers every state', () => {
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 1, answers: [] }), 'Ждём ответ Ватан 1');
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [] }), 'Ждём ответ Ватан 2');
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 1, answers: [answer(1, 'available')] }), 'Ватан 1: в наличии');
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(2, 'available')] }), 'Ватан 2: в наличии');
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 1, answers: [answer(1, 'price_differs', 'дороже на 5')] }),
    'Ватан 1: цена отличается: дороже на 5');
  // Routed 1 -> 2, waiting for «Ватан 2».
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(1, 'unavailable')] }),
    'Ватан 1: нет → Ватан 2 · ждём ответ Ватан 2');
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'available')] }),
    'В аптеке 2'); // rework 1: orange
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'price_differs', 'дороже')] }),
    'Ватан 1: нет → Ватан 2: цена отличается: дороже');
  // Unavailable at both pharmacies.
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'unavailable')] }),
    'Нет в наличии в обеих аптеках'); // rework 1: red
  // Order originally at «Ватан 2»: unavailable is final, no routing text.
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(2, 'unavailable', 'закончился')] }),
    'Ватан 2: нет в наличии (закончился)');
  // Missing pharmacy id falls back to «Ватан 1».
  assert.equal(courierItemAnswerLabel({ answers: [] }), 'Ждём ответ Ватан 1');
  // Old Lambda: nothing to show.
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 1 }), null);
  assert.equal(courierItemAnswerTone({ pharmacy_id: 1 }), null);
  assert.equal(courierItemAnswerTone({ pharmacy_id: 1, answers: [] }), 'wait');
  assert.equal(courierItemAnswerTone({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'unavailable')] }), 'bad');
  assert.equal(courierItemAnswerTone({ pharmacy_id: 1, answers: [answer(1, 'price_differs', 'x')] }), 'warn');
  assert.equal(courierItemAnswerTone({ pharmacy_id: 1, answers: [answer(1, 'available')] }), 'ok');
  assert.equal(courierItemAnswerTone({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'available')] }), 'orange');
  assert.equal(courierItemAnswerTone({ pharmacy_id: 2, answers: [answer(2, 'available')] }), 'ok', 'not routed');
});

test('crossPharmacyMark: owner colours for routed items (rework 1)', () => {
  assert.deepEqual(crossPharmacyMark(true, 'available'), { text: 'В аптеке 2', tone: 'orange' });
  assert.deepEqual(crossPharmacyMark(true, 'unavailable'), { text: 'Нет в наличии в обеих аптеках', tone: 'bad' });
  assert.equal(crossPharmacyMark(true, null), null);
  assert.equal(crossPharmacyMark(true, 'price_differs'), null);
  assert.equal(crossPharmacyMark(false, 'unavailable'), null);
});

test('request validation: pharmacy price only with «В наличии» (rework 1)', () => {
  assert.deepEqual(validatePharmacyAnswersRequest({ answers: [{ order_item_id: 1, answer: 'available', base_unit_price: '45,5' }] }),
    { ok: true, value: { answers: [{ order_item_id: 1, answer: 'available', base_unit_price: '45.50' }] } });
  assert.deepEqual(validatePharmacyAnswersRequest({ answers: [{ order_item_id: 1, answer: 'available', base_unit_price: 40 }] }),
    { ok: true, value: { answers: [{ order_item_id: 1, answer: 'available', base_unit_price: '40.00' }] } });
  for (const price of ['0', '0.00', '-1', '1000000', '1.234', 'abc', '', null, true]) {
    assert.equal(validatePharmacyAnswersRequest({ answers: [{ order_item_id: 1, answer: 'available', base_unit_price: price }] }).ok,
      false, String(price));
  }
  assert.equal(validatePharmacyAnswersRequest({ answers: [{ order_item_id: 1, answer: 'unavailable', base_unit_price: '40' }] }).ok, false);
  assert.equal(normalizePharmacyPrice('999999.99'), '999999.99');
  assert.equal(normalizePharmacyPrice(' 12 '), '12.00');
});

test('confirmedAmountText covers null and value cases', () => {
  assert.equal(confirmedAmountText({}), 'Сумма ещё не подтверждена аптекой');
  assert.equal(confirmedAmountText({ confirmed_total: null, pharmacy_answers_complete: true }), 'Сумма ещё не подтверждена аптекой');
  const text = confirmedAmountText({ confirmed_total: '1250.50', pharmacy_answers_complete: true, unavailable_count: 0 });
  assert.match(text, /^Подтверждённая сумма: 1\s250,5 сом$/);
  assert.equal(confirmedAmountText({ confirmed_total: '0', pharmacy_answers_complete: true }), 'Подтверждённая сумма: 0 сом');
  // Everything unavailable everywhere: no «0 сом», ask the courier to call the client.
  const none = { confirmed_total: '0', pharmacy_answers_complete: true, unavailable_count: 2, item_count: 2 };
  assert.equal(confirmedAmountText(none), 'Все позиции недоступны — свяжитесь с клиентом');
  assert.equal(isAmountConfirmed(none), false);
  assert.equal(confirmedAmountText({ ...none, item_count: undefined }), 'Все позиции недоступны — свяжитесь с клиентом');
  assert.equal(confirmedAmountText({ confirmed_total: '57.50', unavailable_count: 2 }),
    'Подтверждённая сумма: 57,5 сом · без 2 поз. (нет в наличии)');
  assert.equal(isAmountConfirmed({ confirmed_total: '57.50' }), true);
  assert.equal(isAmountConfirmed({ confirmed_total: null }), false);
  assert.equal(isAmountConfirmed({}), false);
});

test('answersProgressText shows N of M only for new Lambda responses', () => {
  assert.equal(answersProgressText({ answered_count: 1, item_count: 3 }), 'Ответ аптек: 1 из 3');
  assert.equal(answersProgressText({}), null);
  assert.equal(answersProgressText({ answered_count: 0, item_count: 0 }), null);
});

test('job 013: row actions build the existing pharmacy-answers payload', () => {
  assert.deepEqual(ROW_ACTION_LABELS, { available: 'В наличии', unavailable: 'Нет в наличии', price: 'Изменить цену',
    save: 'Сохранить' });
  assert.deepEqual(rowActionRequest(81, 'available'),
    { ok: true, value: { answers: [{ order_item_id: 81, answer: 'available' }] } });
  assert.deepEqual(rowActionRequest(81, 'unavailable'),
    { ok: true, value: { answers: [{ order_item_id: 81, answer: 'unavailable' }] } });
  assert.deepEqual(rowActionRequest(81, 'price', '45,5', '40.00'),
    { ok: true, value: { answers: [{ order_item_id: 81, answer: 'available', base_unit_price: '45.50' }] } });
  // Same price or an empty field: plain «В наличии» (also when the policy hides the price).
  assert.deepEqual(rowActionRequest(81, 'price', '40', '40.00'),
    { ok: true, value: { answers: [{ order_item_id: 81, answer: 'available' }] } });
  assert.deepEqual(rowActionRequest(81, 'price', '  ', null),
    { ok: true, value: { answers: [{ order_item_id: 81, answer: 'available' }] } });
  assert.deepEqual(rowActionRequest(81, 'price', '45', null),
    { ok: true, value: { answers: [{ order_item_id: 81, answer: 'available', base_unit_price: '45.00' }] } });
  for (const bad of ['0', '1000000', '1.234', 'abc', '-5']) {
    const result = rowActionRequest(81, 'price', bad, '40.00');
    assert.equal(result.ok, false, bad);
  }
  assert.equal(rowActionRequest(0, 'available').ok, false);
  assert.equal(rowActionRequest(1.5, 'available').ok, false);
  // The UI no longer offers «Цена отличается», but the contract still accepts it.
  assert.equal(validatePharmacyAnswersRequest({ answers: [{ order_item_id: 81, answer: 'price_differs',
    problem: 'дороже на 5' }] }).ok, true);
});

test('job 013: routed rows are orange «Ватан 2» unless «Ватан 2» lacks the item too', () => {
  assert.deepEqual(routedAwayMark(null), { text: 'Ватан 2', tone: 'orange' });
  assert.deepEqual(routedAwayMark('available'), { text: 'Ватан 2', tone: 'orange' });
  assert.deepEqual(routedAwayMark('price_differs'), { text: 'Ватан 2', tone: 'orange' });
  assert.deepEqual(routedAwayMark('unavailable'), { text: 'Нет в наличии в обеих аптеках', tone: 'bad' });
});

test('job 013: the route strips _notification and survives a notifier failure', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const notification = { notification_kind: 'pharmacy_item_change', admin_order_id: 7, changes: [] };
  const data = { order_id: 'ord_x', items: [], routed_away_count: 1, awaiting_response: false, _notification: notification };
  const clean = await forwardChangeNotification(data, async (value) => { sent.push(value); }, () => assert.fail('no error'));
  assert.deepEqual(sent, [notification]);
  assert.equal('_notification' in clean, false);
  assert.deepEqual(clean, { order_id: 'ord_x', items: [], routed_away_count: 1, awaiting_response: false });
  const errors: unknown[] = [];
  const failed = await forwardChangeNotification(data, async () => { throw new Error('notifier down'); },
    (error) => errors.push(error));
  assert.equal(errors.length, 1);
  assert.equal('_notification' in failed, false);
  let calls = 0;
  const plain = await forwardChangeNotification({ order_id: 'ord_x' }, async () => { calls += 1; }, () => undefined);
  assert.equal(calls, 0);
  assert.deepEqual(plain, { order_id: 'ord_x' });
});

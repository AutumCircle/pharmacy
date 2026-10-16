import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHARMACY_ANSWER_LABELS, answersProgressText, confirmedAmountText, courierItemAnswerLabel, courierItemAnswerTone,
  isAmountConfirmed, pharmacyAnswerChip, validatePharmacyAnswersRequest,
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
    { answers: [{ order_item_id: 1, answer: 'available', base_unit_price: '12' }] },
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
    'Ватан 1: нет → Ватан 2: в наличии');
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'price_differs', 'дороже')] }),
    'Ватан 1: нет → Ватан 2: цена отличается: дороже');
  // Unavailable at both pharmacies.
  assert.equal(courierItemAnswerLabel({ pharmacy_id: 2, answers: [answer(1, 'unavailable'), answer(2, 'unavailable')] }),
    'Ватан 1: нет → Ватан 2: нет в наличии · нет ни в одной аптеке');
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
});

test('confirmedAmountText covers null and value cases', () => {
  assert.equal(confirmedAmountText({}), 'Сумма ещё не подтверждена аптекой');
  assert.equal(confirmedAmountText({ confirmed_total: null, pharmacy_answers_complete: true }), 'Сумма ещё не подтверждена аптекой');
  const text = confirmedAmountText({ confirmed_total: '1250.50', pharmacy_answers_complete: true, unavailable_count: 0 });
  assert.match(text, /^Подтверждённая сумма: 1\s250,5 сом$/);
  assert.equal(confirmedAmountText({ confirmed_total: '0', pharmacy_answers_complete: true }), 'Подтверждённая сумма: 0 сом');
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

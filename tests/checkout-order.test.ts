import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSom,
  minimumOrderShortfall,
  parseSavedAddresses,
  paymentMethodLabel,
  rememberAddress,
  sameAddress,
  splitLegacyAddress,
} from '../src/lib/checkout-order.ts';

test('an old order with the landmark in brackets is shown as address + landmark', () => {
  assert.deepEqual(splitLegacyAddress('Такси Худжанд (Отправка кардан даркор такси Худжанд ки )'),
    { address: 'Такси Худжанд', landmark: 'Отправка кардан даркор такси Худжанд ки' });
  assert.deepEqual(splitLegacyAddress('ул. Айни 29 (напротив школы)', null),
    { address: 'ул. Айни 29', landmark: 'напротив школы' });
});

test('an order with its own landmark or without brackets is shown unchanged', () => {
  assert.deepEqual(splitLegacyAddress('ул. Айни 29 (2 этаж)', 'у школы'), { address: 'ул. Айни 29 (2 этаж)', landmark: 'у школы' });
  assert.deepEqual(splitLegacyAddress('ул. Айни 29'), { address: 'ул. Айни 29', landmark: '' });
  assert.deepEqual(splitLegacyAddress('(только скобки)'), { address: '(только скобки)', landmark: '' });
  assert.deepEqual(splitLegacyAddress('ул. Айни 29 ()'), { address: 'ул. Айни 29 ()', landmark: '' });
  assert.deepEqual(splitLegacyAddress('ул. (Айни) 29'), { address: 'ул. (Айни) 29', landmark: '' });
  assert.deepEqual(splitLegacyAddress(null), { address: '', landmark: '' });
});

test('saved addresses accept the old string form and the new object form', () => {
  const raw = JSON.stringify(['ул. Айни 29 (напротив школы)', { address: 'мкр. Сино 52/1', landmark: '' },
    { address: 'ул. Айни 29', landmark: 'напротив школы' }, 'abc', 42, null, { landmark: 'x' }]);
  assert.deepEqual(parseSavedAddresses(raw), [
    { address: 'ул. Айни 29', landmark: 'напротив школы' },
    { address: 'мкр. Сино 52/1', landmark: '' },
  ]);
  assert.deepEqual(parseSavedAddresses('not json'), []);
  assert.deepEqual(parseSavedAddresses('{"a":1}'), []);
});

test('the address used last goes first, without duplicates, at most 8', () => {
  const list = [{ address: 'ул. Айни 29', landmark: '' }, { address: 'мкр. Сино 52/1', landmark: '' }];
  assert.deepEqual(rememberAddress(list, { address: ' мкр. Сино 52/1 ', landmark: '' }),
    [{ address: 'мкр. Сино 52/1', landmark: '' }, { address: 'ул. Айни 29', landmark: '' }]);
  const many = Array.from({ length: 8 }, (_, index) => ({ address: `ул. Рудаки ${index + 10}`, landmark: '' }));
  assert.equal(rememberAddress(many, { address: 'ул. Новая 1', landmark: '' }).length, 8);
  assert.equal(rememberAddress(list, { address: 'abc', landmark: '' }), list);
  assert.ok(sameAddress({ address: 'УЛ. Айни 29', landmark: '' }, { address: 'ул. айни 29', landmark: '' }));
  assert.ok(!sameAddress(null, { address: 'ул. Айни 29', landmark: '' }));
});

test('the 50 с. minimum notice amount is shown only below the minimum', () => {
  assert.equal(minimumOrderShortfall(32), 18);
  assert.equal(minimumOrderShortfall(49.5), 0.5);
  assert.equal(minimumOrderShortfall(50), 0);
  assert.equal(minimumOrderShortfall(186), 0);
  assert.equal(minimumOrderShortfall(Number.NaN), 50);
});

test('payment labels; unknown or missing values are cash', () => {
  assert.equal(paymentMethodLabel('e_wallet'), 'Электронный кошелёк');
  assert.equal(paymentMethodLabel('cash_on_delivery'), 'Наличными курьеру');
  assert.equal(paymentMethodLabel(undefined), 'Наличными курьеру');
  assert.equal(paymentMethodLabel('card'), 'Наличными курьеру');
});

test('money is shown in whole сомони', () => {
  assert.equal(formatSom(186), '186 с.');
  assert.equal(formatSom('64.40'), '64 с.');
  assert.equal(formatSom(null), '0 с.');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidOrderQuantity, parseOrderQuantity, shiftOrderQuantity } from '../src/lib/order-quantity.ts';

test('courier and admin quantities accept tenths including comma input', () => {
  assert.equal(parseOrderQuantity('0,1'), 0.1);
  assert.equal(parseOrderQuantity('0.2'), 0.2);
  assert.equal(parseOrderQuantity('1,2'), 1.2);
  assert.equal(parseOrderQuantity('0,25'), 0.25);
  assert.equal(parseOrderQuantity('99'), 99);
  for (const input of ['', '0', '0.05', '1.234', '99.1', 'abc']) assert.equal(parseOrderQuantity(input), null);
  assert.equal(isValidOrderQuantity(0.3), true);
  assert.equal(isValidOrderQuantity(1.25), true);
});

test('step buttons use integer tenths, clamp and never accumulate floating-point drift', () => {
  assert.equal(shiftOrderQuantity(0.1, -1), 0.1);
  assert.equal(shiftOrderQuantity(99, 1), 99);
  assert.equal(shiftOrderQuantity(0.2, 1), 0.3);
  assert.equal(shiftOrderQuantity(1.2, -1), 1.1);
  assert.equal(shiftOrderQuantity(0.25, 1), 0.35);
  let value = 0.1;
  for (let index = 0; index < 11; index += 1) value = shiftOrderQuantity(value, 1);
  assert.equal(value, 1.2);
});

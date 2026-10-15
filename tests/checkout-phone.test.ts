import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCheckoutPhoneFull,
  isCompleteCheckoutPhone,
  normalizeCheckoutPhoneInput,
} from '../src/lib/checkout-phone.ts';

test('strips +992 from a pasted full number with and without separators', () => {
  assert.equal(normalizeCheckoutPhoneInput('+992 917 12 34 56'), '917123456');
  assert.equal(normalizeCheckoutPhoneInput('+992917123456'), '917123456');
  assert.equal(normalizeCheckoutPhoneInput('992917123456'), '917123456');
  assert.equal(normalizeCheckoutPhoneInput('(+992) 917-12-34-56'), '917123456');
});

test('keeps a nine-digit local number that starts with 992', () => {
  assert.equal(normalizeCheckoutPhoneInput('992123456'), '992123456');
  assert.equal(normalizeCheckoutPhoneInput('992-12-34-56'), '992123456');
  assert.equal(normalizeCheckoutPhoneInput('+992 992 12 34 56'), '992123456');
});

test('never strips 992 from partial input while typing', () => {
  assert.equal(normalizeCheckoutPhoneInput('99'), '99');
  assert.equal(normalizeCheckoutPhoneInput('992'), '992');
  assert.equal(normalizeCheckoutPhoneInput('99212'), '99212');
});

test('truncates over-long input that is not a 12-digit 992 number', () => {
  assert.equal(normalizeCheckoutPhoneInput('9171234567'), '917123456');
  assert.equal(normalizeCheckoutPhoneInput('00992917123456'), '009929171');
});

test('empty input stays empty', () => {
  assert.equal(normalizeCheckoutPhoneInput(''), '');
  assert.equal(normalizeCheckoutPhoneInput('+ ( ) -'), '');
});

test('formats a complete number as +992 XXX XXX XXX', () => {
  assert.equal(formatCheckoutPhoneFull('917123456'), '+992 917 123 456');
  assert.equal(formatCheckoutPhoneFull('992123456'), '+992 992 123 456');
});

test('incomplete or invalid local digits produce an empty string', () => {
  assert.equal(formatCheckoutPhoneFull(''), '');
  assert.equal(formatCheckoutPhoneFull('9171234'), '');
  assert.equal(formatCheckoutPhoneFull('9171234567'), '');
  assert.equal(formatCheckoutPhoneFull('917-12-34-56'), '');
});

test('isCompleteCheckoutPhone requires exactly nine digits', () => {
  assert.equal(isCompleteCheckoutPhone('917123456'), true);
  assert.equal(isCompleteCheckoutPhone('91712345'), false);
  assert.equal(isCompleteCheckoutPhone('9171234567'), false);
  assert.equal(isCompleteCheckoutPhone(''), false);
});

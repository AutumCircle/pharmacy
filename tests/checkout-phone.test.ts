import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCheckoutPhoneEdit,
  caretAfterDigits,
  formatCheckoutPhoneFull,
  formatCheckoutPhoneInput,
  isCompleteCheckoutPhone,
  normalizeCheckoutPhoneInput,
} from '../src/lib/checkout-phone.ts';

test('the input shows 3-2-2-2 groups separated by spaces, never dashes', () => {
  assert.equal(formatCheckoutPhoneInput(''), '');
  assert.equal(formatCheckoutPhoneInput('917'), '917');
  assert.equal(formatCheckoutPhoneInput('9171'), '917 1');
  assert.equal(formatCheckoutPhoneInput('917123456'), '917 12 34 56');
  assert.equal(formatCheckoutPhoneInput('917-12-34-56'), '917 12 34 56');
});

test('caret positions follow digits, skipping spaces', () => {
  assert.equal(caretAfterDigits('917 12 34 56', 0), 0);
  assert.equal(caretAfterDigits('917 12 34 56', 3), 3);
  assert.equal(caretAfterDigits('917 12 34 56', 4), 5);
  assert.equal(caretAfterDigits('917 12 34 56', 9), 12);
});

test('typing a digit moves the caret past the inserted space', () => {
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '917', value: '9171', selectionStart: 4, inputType: 'insertText' }),
    { digits: '9171', formatted: '917 1', caret: 5 });
});

test('Backspace right after a space deletes the digit before it instead of getting stuck', () => {
  // «917 |12»: the browser removed only the space.
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '91712', value: '91712', selectionStart: 3,
    inputType: 'deleteContentBackward' }), { digits: '9112', formatted: '911 2', caret: 2 });
  // A full number: «917 12 34 |56» → «917 12 3|5 6».
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '917123456', value: '917 12 3456', selectionStart: 9,
    inputType: 'deleteContentBackward' }), { digits: '91712356', formatted: '917 12 35 6', caret: 8 });
});

test('Backspace on a digit removes it and keeps the caret in place', () => {
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '9171', value: '917 ', selectionStart: 4,
    inputType: 'deleteContentBackward' }), { digits: '917', formatted: '917', caret: 3 });
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '917123456', value: '917 2 34 56', selectionStart: 4,
    inputType: 'deleteContentBackward' }), { digits: '91723456', formatted: '917 23 45 6', caret: 3 });
});

test('Delete right before a space deletes the next digit', () => {
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '91712', value: '91712', selectionStart: 3,
    inputType: 'deleteContentForward' }), { digits: '9172', formatted: '917 2', caret: 3 });
});

test('Backspace at the very start changes nothing', () => {
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '917', value: '917', selectionStart: 0,
    inputType: 'deleteContentBackward' }), { digits: '917', formatted: '917', caret: 0 });
});

test('a pasted full +992 number keeps the 9 local digits with the caret at the end', () => {
  assert.deepEqual(applyCheckoutPhoneEdit({ previousDigits: '', value: '+992 917 12 34 56', selectionStart: 17,
    inputType: 'insertFromPaste' }), { digits: '917123456', formatted: '917 12 34 56', caret: 12 });
});

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

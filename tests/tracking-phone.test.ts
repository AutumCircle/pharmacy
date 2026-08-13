import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTrackingPhone } from '../src/lib/tracking-phone.ts';

test('accepts exactly nine local digits', () => {
  const result = parseTrackingPhone('917123456');
  assert.equal(result.valid, true);
  assert.equal(result.formatted, '917-12-34-56');
  assert.equal(result.normalized, '+992917123456');
});

test('rejects an incomplete number', () => {
  assert.equal(parseTrackingPhone('917-12-34').valid, false);
});

test('rejects excessive local digits without growing the formatted value', () => {
  const result = parseTrackingPhone('9171234567');
  assert.equal(result.valid, false);
  assert.equal(result.formatted, '917-12-34-56');
});

test('accepts a pasted Tajik canonical number with separators', () => {
  const result = parseTrackingPhone('+992 (917) 12-34-56');
  assert.equal(result.valid, true);
  assert.equal(result.normalized, '+992917123456');
});

test('accepts an already formatted local number', () => {
  assert.equal(parseTrackingPhone('917-12-34-56').valid, true);
});

test('rejects malformed alphabetic input', () => {
  assert.equal(parseTrackingPhone('917-12-AB-56').valid, false);
});

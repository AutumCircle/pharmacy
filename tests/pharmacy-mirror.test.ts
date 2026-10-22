import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mirrorQuantity,
  mirrorSearchError,
  validMirrorProducts,
  validMirrorDetail,
  validMirrorStatus,
} from '../src/lib/pharmacy-mirror.ts';

test('search validates short names and permits a one digit exact ID', () => {
  assert.match(mirrorSearchError('a', 'name'), /минимум 2/);
  assert.equal(mirrorSearchError('1', 'auto'), '');
  assert.match(mirrorSearchError('1 OR true', 'id'), /цифры/);
  assert.equal(mirrorSearchError('a%_', 'name'), '');
});
test('missing stock is not displayed as zero and corrupt totals are explicit', () => {
  assert.equal(mirrorQuantity(null, 0, 0), 'Нет строк остатков');
  assert.equal(mirrorQuantity('0', 3, 0), '0');
  assert.equal(mirrorQuantity('0.5', 3, 0), '0.5');
  assert.equal(mirrorQuantity('7', 3, 1), 'Есть некорректные значения');
});
test('contracts reject unbounded sets and malformed row data', () => {
  assert.equal(validMirrorProducts({ items: [], total: 0, page: 1, limit: 25 }), true);
  assert.equal(validMirrorProducts({ items: [], total: 0, page: 1, limit: 100 }), false);
  assert.equal(
    validMirrorProducts({ items: Array(26).fill({}), total: 26, page: 1, limit: 25 }),
    false,
  );
  assert.equal(validMirrorProducts({ items: [], total: -1, page: 1, limit: 25 }), false);
  assert.equal(validMirrorDetail({ product: { oracle: 'private' } }), false);
  assert.equal(validMirrorStatus({ tables: [] }), false);
});

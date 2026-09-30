import assert from 'node:assert/strict';
import test from 'node:test';

import { getPaginationItems } from '../src/lib/pagination.ts';

test('shows every page when total is small', () => {
  assert.deepEqual(getPaginationItems(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPaginationItems(1, 1), [1]);
});

test('desktop keeps first three and last two pages', () => {
  assert.deepEqual(getPaginationItems(1, 20), [1, 2, 3, 'ellipsis-left', 19, 20]);
  assert.deepEqual(getPaginationItems(8, 20), [1, 2, 3, 'ellipsis-left', 7, 8, 9, 'ellipsis-right', 19, 20]);
  assert.deepEqual(getPaginationItems(20, 20), [1, 2, 3, 'ellipsis-left', 19, 20]);
  assert.deepEqual(getPaginationItems(4, 20), [1, 2, 3, 4, 5, 'ellipsis-left', 19, 20]);
});

test('compact mode for phones shows first, current and last', () => {
  assert.deepEqual(getPaginationItems(8, 20, true), [1, 'ellipsis-left', 8, 'ellipsis-right', 20]);
  assert.deepEqual(getPaginationItems(1, 20, true), [1, 'ellipsis-left', 20]);
  assert.deepEqual(getPaginationItems(2, 3, true), [1, 2, 3]);
});

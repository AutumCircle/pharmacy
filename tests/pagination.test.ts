import assert from 'node:assert/strict';
import test from 'node:test';

import { getPaginationItems } from '../src/lib/pagination.ts';

test('shows every category page when total is small', () => {
  assert.deepEqual(getPaginationItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('keeps a compact numbered window for long categories', () => {
  assert.deepEqual(getPaginationItems(6, 20), [1, 'ellipsis-left', 5, 6, 7, 'ellipsis-right', 20]);
  assert.deepEqual(getPaginationItems(20, 20), [1, 'ellipsis-left', 16, 17, 18, 19, 20]);
});

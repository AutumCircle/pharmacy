import assert from 'node:assert/strict';
import test from 'node:test';

import { selectPage, toggleSelection } from '../src/lib/admin-selection.ts';

test('toggleSelection is immutable and toggles one medicine id', () => {
  const current = new Set([10, 20]);
  const added = toggleSelection(current, 30);
  const removed = toggleSelection(added, 20);
  assert.deepEqual([...current], [10, 20]);
  assert.deepEqual([...added], [10, 20, 30]);
  assert.deepEqual([...removed], [10, 30]);
});

test('selectPage excludes rows that are already present', () => {
  assert.deepEqual([...selectPage([1, 2, 3, 4], new Set([2, 4]))], [1, 3]);
});

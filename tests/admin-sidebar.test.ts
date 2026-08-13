import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_SIDEBAR_STORAGE_KEY, readSidebarCollapsed, writeSidebarCollapsed } from '../src/lib/admin-sidebar.ts';

test('sidebar preference persists and is restored', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(readSidebarCollapsed(storage), false);
  writeSidebarCollapsed(storage, true);
  assert.equal(values.get(ADMIN_SIDEBAR_STORAGE_KEY), 'true');
  assert.equal(readSidebarCollapsed(storage), true);
});

test('sidebar remains usable when storage is blocked', () => {
  const blocked = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  assert.equal(readSidebarCollapsed(blocked), false);
  assert.doesNotThrow(() => writeSidebarCollapsed(blocked, true));
});

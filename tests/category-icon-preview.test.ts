import assert from 'node:assert/strict';
import test from 'node:test';

test('local icon upload, removal and reset never require a network request', async () => {
  process.env.NODE_ENV = 'development';
  const values = new Map<string, string>();
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
  const { readLocalIcon, saveLocalIcon, subscribeLocalIcons } = await import('../src/lib/category-icon-preview.ts');
  let updates = 0;
  const unsubscribe = subscribeLocalIcons(() => updates++);
  saveLocalIcon(4, 'data:image/png;base64,test');
  assert.equal(readLocalIcon(4), 'data:image/png;base64,test');
  assert.equal(readLocalIcon(5), null);
  saveLocalIcon(4, '');
  assert.equal(readLocalIcon(4), '');
  saveLocalIcon(4, null);
  assert.equal(readLocalIcon(4), null);
  assert.equal(updates, 3);
  unsubscribe();
});

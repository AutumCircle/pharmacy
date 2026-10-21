import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVE_REFRESH_MS, LIVE_REFRESH_OVERVIEW_MS, isEditingElement, shouldRefresh,
} from '../src/lib/live-refresh.ts';

test('work screens refresh about every 5 s, the overview less often', () => {
  assert.equal(LIVE_REFRESH_MS, 5_000);
  assert.ok(LIVE_REFRESH_OVERVIEW_MS > LIVE_REFRESH_MS);
});

test('refreshes only a visible, idle screen', () => {
  assert.equal(shouldRefresh({ visible: true, pending: false, editing: false }), true);
  assert.equal(shouldRefresh({ visible: false, pending: false, editing: false }), false);
  assert.equal(shouldRefresh({ visible: true, pending: true, editing: false }), false);
  assert.equal(shouldRefresh({ visible: true, pending: false, editing: true }), false);
});

test('typing fields pause the refresh, buttons and checkboxes do not', () => {
  assert.equal(isEditingElement(null), false);
  assert.equal(isEditingElement({ tagName: 'BODY' }), false);
  assert.equal(isEditingElement({ tagName: 'BUTTON' }), false);
  assert.equal(isEditingElement({ tagName: 'INPUT' }), true);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'date' }), true);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'submit' }), false);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'text', readOnly: true }), false);
  assert.equal(isEditingElement({ tagName: 'INPUT', type: 'text', disabled: true }), false);
  assert.equal(isEditingElement({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditingElement({ tagName: 'SELECT' }), true);
  assert.equal(isEditingElement({ tagName: 'DIV', isContentEditable: true }), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IOS_HINT, PHARMACY_ONE_REMIND_MS, PHARMACY_SOUND_KEY, REMIND_MS, SOUND_BLOCKED, SOUND_UNAVAILABLE,
  alertText, attentionBannerText, attentionCount, dueAlerts,
  permissionView, remindIntervalMs, soundClickAction, soundLabel,
  titleWithCount,
} from '../src/lib/pharmacy-alerts.ts';

const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const open = (order_id: string, extra: Record<string, unknown> = {}) =>
  ({ order_id, order_reference: `REF-${order_id}`, needs_attention: true, attention_since: '2026-10-16T09:00:00+00:00', ...extra });

test('REMIND_MS is three minutes and the sound key is separate from the courier key', () => {
  assert.equal(REMIND_MS, 180_000);
  assert.equal(PHARMACY_ONE_REMIND_MS, 60_000);
  assert.equal(PHARMACY_SOUND_KEY, 'vatan-pharmacy-sound');
  assert.notEqual(PHARMACY_SOUND_KEY, 'vatan-order-sound');
});

test('pharmacy 1 is reminded each minute, pharmacy 2 keeps its three-minute interval', () => {
  const first = dueAlerts([open('a')], new Map(), T0, PHARMACY_ONE_REMIND_MS);
  assert.deepEqual(dueAlerts([open('a')], first.lastAlerted, T0 + 59_999, PHARMACY_ONE_REMIND_MS).due, []);
  assert.deepEqual(dueAlerts([open('a')], first.lastAlerted, T0 + 60_000, PHARMACY_ONE_REMIND_MS).due, ['a']);
  assert.deepEqual(dueAlerts([open('a')], first.lastAlerted, T0 + 60_000, REMIND_MS).due, []);
});

test('remindIntervalMs: 60 s for pharmacy 1, 180 s for pharmacy 2 (job 013)', () => {
  assert.equal(remindIntervalMs(1), 60_000);
  assert.equal(remindIntervalMs(2), 180_000);
  assert.equal(remindIntervalMs(null), 180_000);
  const first = dueAlerts([open('a')], new Map(), T0, remindIntervalMs(2));
  assert.deepEqual(dueAlerts([open('a')], first.lastAlerted, T0 + 179_999, remindIntervalMs(2)).due, []);
  assert.deepEqual(dueAlerts([open('a')], first.lastAlerted, T0 + 180_000, remindIntervalMs(2)).due, ['a']);
});

test('an order keeps alerting while needs_attention stays true and stops once assembled', () => {
  const first = dueAlerts([open('a')], new Map(), T0, remindIntervalMs(1));
  // Answered / «Начать сборку»: the Lambda still says needs_attention, so it repeats each minute.
  const answered = dueAlerts([open('a')], first.lastAlerted, T0 + 60_000, remindIntervalMs(1));
  assert.deepEqual(answered.due, ['a']);
  // «Сборка сделана»: needs_attention false, no more alerts and the attention count is 0 (alarm stops).
  const assembled = [open('a', { needs_attention: false, attention_since: null })];
  assert.deepEqual(dueAlerts(assembled, answered.lastAlerted, T0 + 10 * 60_000, remindIntervalMs(1)).due, []);
  assert.equal(attentionCount(assembled), 0);
});

test('attentionBannerText says «Сборка сделана» and nothing for zero', () => {
  assert.equal(attentionBannerText(2), 'Заказов ждут «Сборка сделана»: 2');
  assert.equal(attentionBannerText(0), null);
});

test('dueAlerts alerts an order the first time it is seen with needs_attention', () => {
  const result = dueAlerts([open('a')], new Map(), T0);
  assert.deepEqual(result.due, ['a']);
  assert.equal(result.lastAlerted.get('a'), T0);
});

test('dueAlerts does not alert again before 180 s and alerts again at 180 s or later', () => {
  const first = dueAlerts([open('a')], new Map(), T0);
  const early = dueAlerts([open('a')], first.lastAlerted, T0 + REMIND_MS - 1);
  assert.deepEqual(early.due, []);
  assert.equal(early.lastAlerted.get('a'), T0);
  const exact = dueAlerts([open('a')], early.lastAlerted, T0 + REMIND_MS);
  assert.deepEqual(exact.due, ['a']);
  assert.equal(exact.lastAlerted.get('a'), T0 + REMIND_MS);
  const later = dueAlerts([open('a')], first.lastAlerted, T0 + REMIND_MS + 45_000);
  assert.deepEqual(later.due, ['a']);
  // The clock restarts from the last alert.
  assert.deepEqual(dueAlerts([open('a')], exact.lastAlerted, T0 + REMIND_MS + 30_000).due, []);
});

test('dueAlerts never alerts a reacted order and forgets it', () => {
  const first = dueAlerts([open('a'), open('b')], new Map(), T0);
  assert.deepEqual(first.due, ['a', 'b']);
  const reacted = dueAlerts([open('a', { needs_attention: false, attention_since: null }), open('b')],
    first.lastAlerted, T0 + REMIND_MS);
  assert.deepEqual(reacted.due, ['b']);
  assert.equal(reacted.lastAlerted.has('a'), false);
  assert.deepEqual(dueAlerts([open('a', { needs_attention: false })], new Map(), T0).due, []);
});

test('dueAlerts never alerts an order absent from the list', () => {
  const first = dueAlerts([open('a')], new Map(), T0);
  const gone = dueAlerts([], first.lastAlerted, T0 + 10 * REMIND_MS);
  assert.deepEqual(gone.due, []);
  assert.equal(gone.lastAlerted.size, 0);
});

test('dueAlerts alerts nothing when needs_attention is missing (old Lambda)', () => {
  const old = [{ order_id: 'a', order_reference: '1' }, { order_id: 'b', needs_attention: 'true' as unknown as boolean }];
  assert.deepEqual(dueAlerts(old, new Map(), T0).due, []);
  assert.deepEqual(dueAlerts(old, new Map([['a', T0 - 10 * REMIND_MS]]), T0).due, []);
  assert.equal(attentionCount(old), 0);
});

test('dueAlerts handles mixed queues and does not mutate the input map', () => {
  const previous = new Map([['a', T0]]);
  const result = dueAlerts([open('a'), open('c'), open('d', { needs_attention: false })], previous, T0 + 60_000);
  assert.deepEqual(result.due, ['c']);
  assert.deepEqual([...previous], [['a', T0]]);
  assert.equal(attentionCount([open('a'), open('c'), open('d', { needs_attention: false })]), 2);
});

test('alertText uses the reference and the waiting minutes', () => {
  assert.deepEqual(alertText(open('ord_abc'), T0 + 7 * 60_000 + 59_000),
    { title: 'Заказ № REF-ord_abc', body: 'Ждёт сборки 7 мин' });
});

test('alertText falls back to the last 6 characters of order_id', () => {
  const text = alertText({ order_id: 'ord_0123456789', needs_attention: true, attention_since: '2026-10-16T09:00:00Z' }, T0);
  assert.equal(text.title, 'Заказ № 456789');
  assert.equal(text.body, 'Ждёт сборки 0 мин');
  assert.equal(alertText({ order_id: 'ord_0123456789', order_reference: '   ' }, T0).title, 'Заказ № 456789');
  assert.equal(alertText({ order_id: 'ord_0123456789', order_reference: null }, T0).body, 'Ждёт сборки 0 мин');
  assert.equal(alertText({ order_id: 'x', attention_since: 'not a time' }, T0).body, 'Ждёт сборки 0 мин');
});

test('alertText carries no client data even when the order object has it', () => {
  const order = {
    ...open('ord_secret'), customer_name: 'Фарход Секретов', phone: '+992917123456', address: 'ул. Тайная 7',
    landmark: 'у рынка', notes: 'позвонить', comment: 'позвонить', order_total: '999.50', base_total: '800',
  };
  const text = alertText(order, T0 + 3 * 60_000);
  const joined = `${text.title} ${text.body}`;
  for (const secret of ['Фарход', 'Секретов', '917123456', 'Тайная', 'рынка', 'позвонить', '999', '800']) {
    assert.equal(joined.includes(secret), false, secret);
  }
  assert.deepEqual(Object.keys(text).sort(), ['body', 'title']);
});

test('titleWithCount adds and removes the (N) prefix', () => {
  assert.equal(titleWithCount('Vatan', 2), '(2) Vatan');
  assert.equal(titleWithCount('(2) Vatan', 3), '(3) Vatan');
  assert.equal(titleWithCount('(3) Vatan', 0), 'Vatan');
});

test('permissionView maps every permission state', () => {
  const base = { standalone: false, ios: false };
  const granted = permissionView({ ...base, supported: true, permission: 'granted' });
  assert.equal(granted.state, 'granted');
  assert.equal(granted.text, 'Уведомления разрешены');
  assert.equal(granted.canRequest, false);
  const denied = permissionView({ ...base, supported: true, permission: 'denied' });
  assert.equal(denied.text, 'Уведомления запрещены — включите их в настройках браузера');
  assert.equal(denied.canRequest, false);
  const ask = permissionView({ ...base, supported: true, permission: 'default' });
  assert.equal(ask.state, 'default');
  assert.equal(ask.text, 'Не запрошено');
  assert.equal(ask.canRequest, true);
  const unsupported = permissionView({ ...base, supported: false, permission: 'granted' });
  assert.equal(unsupported.state, 'unsupported');
  assert.equal(unsupported.text, 'Этот браузер не поддерживает уведомления');
  assert.equal(unsupported.canRequest, false);
});

test('permissionView reports the installed state and the iOS hint only outside standalone', () => {
  assert.equal(permissionView({ supported: true, permission: 'default', standalone: true, ios: false }).installed,
    'Приложение установлено на экран „Домой“');
  assert.equal(permissionView({ supported: true, permission: 'default', standalone: false, ios: false }).installed,
    'Открыто в браузере (не установлено)');
  assert.equal(permissionView({ supported: false, standalone: false, ios: true }).iosHint, IOS_HINT);
  assert.equal(permissionView({ supported: true, permission: 'granted', standalone: true, ios: true }).iosHint, null);
  assert.equal(permissionView({ supported: true, permission: 'default', standalone: false, ios: false }).iosHint, null);
  assert.equal(IOS_HINT, 'На iPhone уведомления работают только для приложения, добавленного на экран „Домой“ (iOS 16.4+)');
});

test('soundLabel follows preference and the first-tap unlock', () => {
  assert.equal(soundLabel(false, false), 'Включить звук');
  assert.equal(soundLabel(false, true), 'Включить звук');
  assert.equal(soundLabel(true, false), 'Нажмите, чтобы включить звук');
  assert.equal(soundLabel(true, true), 'Звук включён');
});

test('soundClickAction never dead-ends on the unlock prompt', () => {
  assert.equal(soundClickAction(false, false, false), 'enable');
  assert.equal(soundClickAction(false, false, true), 'enable');
  assert.equal(soundClickAction(true, false, false), 'unlock');
  assert.equal(soundClickAction(true, false, true), 'disable');
  assert.equal(soundClickAction(true, true, false), 'disable');
  assert.ok(SOUND_UNAVAILABLE.includes('Сигнал на экране работает'));
  assert.ok(SOUND_BLOCKED.includes('выключить звук'));
});

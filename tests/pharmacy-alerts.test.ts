import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ALARM_CONFIG, IOS_HINT, PHARMACY_SOUND_KEY, REMIND_MS, SOUND_HINT, SOUND_UNAVAILABLE, UNLOCK_EVENTS,
  alertText, attentionBannerText, attentionCount, dueAlerts, parseAlarmConfig,
  permissionView, remindIntervalMs, soundLabel, soundPreference, systemNotification,
  titleWithCount,
} from '../src/lib/pharmacy-alerts.ts';

const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
const open = (order_id: string, extra: Record<string, unknown> = {}) =>
  ({ order_id, order_reference: `REF-${order_id}`, needs_attention: true, attention_since: '2026-10-16T09:00:00+00:00', ...extra });

test('REMIND_MS is one minute and the sound key is separate from the courier key', () => {
  assert.equal(REMIND_MS, 60_000);
  assert.equal(PHARMACY_SOUND_KEY, 'vatan-pharmacy-sound');
  assert.notEqual(PHARMACY_SOUND_KEY, 'vatan-order-sound');
});

test('remindIntervalMs is the same for both pharmacies: 60 s by default, the owner interval otherwise', () => {
  assert.equal(remindIntervalMs(), 60_000);
  assert.equal(remindIntervalMs(DEFAULT_ALARM_CONFIG), 60_000);
  assert.equal(remindIntervalMs(parseAlarmConfig({ ringtone: 'bell', duration_seconds: 30, interval_seconds: 90 })), 90_000);
  // The function takes no pharmacy id any more: «Ватан 1» and «Ватан 2» use one value.
  assert.equal(remindIntervalMs.length, 0);
});

test('dueAlerts with a 60 s interval repeats each minute for «Ватан 1» and «Ватан 2» alike', () => {
  for (const pharmacy of [1, 2]) {
    const interval = remindIntervalMs(parseAlarmConfig(undefined));
    const first = dueAlerts([open(`p${pharmacy}`)], new Map(), T0, interval);
    assert.deepEqual(first.due, [`p${pharmacy}`]);
    assert.deepEqual(dueAlerts([open(`p${pharmacy}`)], first.lastAlerted, T0 + 59_999, interval).due, []);
    assert.deepEqual(dueAlerts([open(`p${pharmacy}`)], first.lastAlerted, T0 + 60_000, interval).due, [`p${pharmacy}`]);
  }
});

test('an order keeps alerting while needs_attention stays true and stops once assembled', () => {
  const first = dueAlerts([open('a')], new Map(), T0, remindIntervalMs());
  // Answered / «Начать сборку»: the Lambda still says needs_attention, so it repeats each minute.
  const answered = dueAlerts([open('a')], first.lastAlerted, T0 + 60_000, remindIntervalMs());
  assert.deepEqual(answered.due, ['a']);
  // «Сборка сделана»: needs_attention false, no more alerts and the attention count is 0 (alarm stops).
  const assembled = [open('a', { needs_attention: false, attention_since: null })];
  assert.deepEqual(dueAlerts(assembled, answered.lastAlerted, T0 + 10 * 60_000, remindIntervalMs()).due, []);
  assert.equal(attentionCount(assembled), 0);
});

test('attentionBannerText says «Собран» (job 015) and nothing for zero', () => {
  assert.equal(attentionBannerText(2), 'Заказов ждут «Собран»: 2');
  assert.equal(attentionBannerText(0), null);
});

test('dueAlerts alerts an order the first time it is seen with needs_attention', () => {
  const result = dueAlerts([open('a')], new Map(), T0);
  assert.deepEqual(result.due, ['a']);
  assert.equal(result.lastAlerted.get('a'), T0);
});

test('dueAlerts does not alert again before the interval and alerts again at it or later', () => {
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
  const result = dueAlerts([open('a'), open('c'), open('d', { needs_attention: false })], previous, T0 + 30_000);
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

test('sound is always on: no stored value, the old «0» and «1» all count as on', () => {
  assert.equal(soundPreference(null), true);
  assert.equal(soundPreference(undefined), true);
  assert.equal(soundPreference('0'), true);
  assert.equal(soundPreference('1'), true);
  assert.equal(soundPreference('garbage'), true);
});

test('soundLabel is a status indicator and never asks to switch the sound on', () => {
  assert.equal(soundLabel(true), 'Звук включён');
  assert.equal(soundLabel(false), 'Звук включён — коснитесь экрана');
  for (const label of [soundLabel(true), soundLabel(false)]) {
    assert.equal(label.includes('Включить звук'), false);
    assert.equal(label.includes('Нажмите, чтобы включить звук'), false);
  }
  assert.ok(SOUND_UNAVAILABLE.includes('Сигнал на экране'));
  assert.equal(SOUND_HINT, 'Чтобы звук работал сразу, установите приложение или разрешите звук для сайта в настройках браузера');
  assert.deepEqual([...UNLOCK_EVENTS], ['pointerdown', 'keydown', 'touchstart']);
});

test('systemNotification: tag per order, renotify, text from alertText only', () => {
  const order = {
    ...open('ord_x1'), customer_name: 'Фарход Секретов', phone: '+992917123456', address: 'ул. Тайная 7',
    notes: 'позвонить', order_total: '999.50',
  };
  const notification = systemNotification(order, T0 + 2 * 60_000);
  assert.deepEqual(notification, {
    title: 'Заказ № REF-ord_x1',
    options: { body: 'Ждёт сборки 2 мин', tag: 'pharmacy-ord_x1', renotify: true },
  });
  const text = JSON.stringify(notification);
  for (const secret of ['Фарход', '917123456', 'Тайная', 'позвонить', '999']) assert.equal(text.includes(secret), false, secret);
});

test('parseAlarmConfig reads the queue alarm and falls back to classic / 60 s / 60 s', () => {
  assert.deepEqual(DEFAULT_ALARM_CONFIG, { ringtone: 'classic', durationSeconds: 60, intervalSeconds: 60 });
  assert.deepEqual(parseAlarmConfig({ ringtone: 'melody', duration_seconds: 45, interval_seconds: 300 }),
    { ringtone: 'melody', durationSeconds: 45, intervalSeconds: 300 });
  for (const raw of [undefined, null, 'classic', 5, [], {}]) {
    assert.deepEqual(parseAlarmConfig(raw), DEFAULT_ALARM_CONFIG, JSON.stringify(raw));
  }
  // Unknown ringtone -> classic; missing / non-numeric numbers -> defaults.
  assert.deepEqual(parseAlarmConfig({ ringtone: 'siren', duration_seconds: '30', interval_seconds: null }), DEFAULT_ALARM_CONFIG);
  assert.deepEqual(parseAlarmConfig({ ringtone: 'bell', duration_seconds: Number.NaN, interval_seconds: Infinity }),
    { ringtone: 'bell', durationSeconds: 60, intervalSeconds: 60 });
});

test('parseAlarmConfig clamps out-of-range values and keeps duration within the interval', () => {
  assert.deepEqual(parseAlarmConfig({ ringtone: 'pulse', duration_seconds: 1, interval_seconds: 5 }),
    { ringtone: 'pulse', durationSeconds: 5, intervalSeconds: 30 });
  assert.deepEqual(parseAlarmConfig({ ringtone: 'pulse', duration_seconds: 500, interval_seconds: 5000 }),
    { ringtone: 'pulse', durationSeconds: 120, intervalSeconds: 600 });
  assert.deepEqual(parseAlarmConfig({ ringtone: 'bell', duration_seconds: 120, interval_seconds: 30 }),
    { ringtone: 'bell', durationSeconds: 30, intervalSeconds: 30 });
  assert.deepEqual(parseAlarmConfig({ ringtone: 'bell', duration_seconds: 44.6, interval_seconds: 90.2 }),
    { ringtone: 'bell', durationSeconds: 45, intervalSeconds: 90 });
});

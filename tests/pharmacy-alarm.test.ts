import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALARM_DURATION_MAX, ALARM_ERRORS, DEFAULT_PHARMACY_ALARM, MAX_GAIN, PREVIEW_SECONDS, RINGTONES, RINGTONE_PATTERNS,
  alarmSettingsOrDefault, createAlarmSlot, isRingtone, schedulePharmacyAlarm, validateAlarmForm,
  type RingtoneId,
} from '../src/lib/pharmacy-alarm.ts';

type Recorded = { starts: number[]; stops: number[]; peaks: number[]; manualStops: number; disconnected: number };

function fakeContext(now = 100) {
  const recorded: Recorded = { starts: [], stops: [], peaks: [], manualStops: 0, disconnected: 0 };
  const context = {
    currentTime: now,
    destination: {},
    createOscillator: () => ({
      type: '', frequency: { value: 0 },
      connect: (gain: unknown) => ({ connect: () => gain }),
      start: (at: number) => { recorded.starts.push(at); },
      stop: (at?: number) => { if (at === undefined) recorded.manualStops += 1; else recorded.stops.push(at); },
      disconnect: () => { recorded.disconnected += 1; },
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: (value: number) => { if (value > 0.001) recorded.peaks.push(value); },
      },
      connect: () => ({}), disconnect: () => { recorded.disconnected += 1; },
    }),
  } as unknown as AudioContext;
  return { context, recorded };
}

test('there are exactly four ringtones with Russian names', () => {
  assert.deepEqual(RINGTONES.map((ringtone) => ringtone.id), ['classic', 'bell', 'pulse', 'melody']);
  assert.deepEqual(RINGTONES.map((ringtone) => ringtone.label), ['Классический', 'Колокол', 'Пульс', 'Мелодия']);
  assert.ok(isRingtone('bell'));
  assert.equal(isRingtone('siren'), false);
  assert.equal(isRingtone(undefined), false);
});

for (const { id } of RINGTONES) {
  for (const seconds of [5, 60, 120]) {
    test(`${id}: ${seconds} s alarm stays inside the duration and fills it`, () => {
      const { context, recorded } = fakeContext();
      const stop = schedulePharmacyAlarm(context, id, seconds);
      assert.ok(recorded.starts.length > 0);
      assert.equal(recorded.starts.length, recorded.stops.length);
      assert.ok(recorded.starts.every((at) => at >= 100 && at < 100 + seconds));
      // No note ends after start + duration.
      assert.ok(recorded.stops.every((at) => at > 100 && at <= 100 + seconds), `${id} ${seconds}`);
      // It really rings until near the end (the last period starts within one period of the end).
      const period = RINGTONE_PATTERNS[id as RingtoneId].period;
      assert.ok(Math.max(...recorded.starts) >= 100 + seconds - period - 0.001);
      assert.ok(recorded.peaks.every((gain) => gain <= MAX_GAIN));
      assert.ok(MAX_GAIN <= 0.22);
      stop();
      // The stop function stops and disconnects every oscillator (and its gain).
      assert.equal(recorded.manualStops, recorded.starts.length);
      assert.equal(recorded.disconnected, recorded.starts.length * 2);
    });
  }
}

test('unknown ringtone plays classic and a bad length plays the 60 s default, capped at 120 s', () => {
  const classic = fakeContext();
  schedulePharmacyAlarm(classic.context, 'classic', 60);
  const unknown = fakeContext();
  schedulePharmacyAlarm(unknown.context, 'siren', 60);
  assert.deepEqual(unknown.recorded.starts, classic.recorded.starts);
  for (const seconds of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
    const { context, recorded } = fakeContext();
    schedulePharmacyAlarm(context, 'pulse', seconds);
    assert.ok(Math.max(...recorded.stops) <= 160, String(seconds));
    assert.ok(Math.max(...recorded.stops) > 159, String(seconds));
  }
  const long = fakeContext();
  schedulePharmacyAlarm(long.context, 'pulse', 600);
  assert.ok(Math.max(...long.recorded.stops) <= 100 + ALARM_DURATION_MAX);
  const defaults = fakeContext();
  schedulePharmacyAlarm(defaults.context);
  assert.deepEqual(defaults.recorded.starts, classic.recorded.starts);
});

test('a new due alert stops the previous alarm; stop silences the slot', () => {
  const slot = createAlarmSlot();
  const first = fakeContext();
  slot.play(() => schedulePharmacyAlarm(first.context, 'bell', 60));
  assert.equal(slot.playing, true);
  assert.equal(first.recorded.manualStops, 0);
  const second = fakeContext();
  slot.play(() => schedulePharmacyAlarm(second.context, 'melody', 60));
  assert.equal(first.recorded.manualStops, first.recorded.starts.length);
  assert.equal(second.recorded.manualStops, 0);
  slot.stop();
  assert.equal(second.recorded.manualStops, second.recorded.starts.length);
  assert.equal(slot.playing, false);
  slot.stop();
  assert.equal(second.recorded.manualStops, second.recorded.starts.length);
});

test('validateAlarmForm accepts whole seconds within bounds and returns the payload', () => {
  assert.deepEqual(validateAlarmForm('bell', '60', '60'),
    { ok: true, value: { ringtone: 'bell', duration_seconds: 60, interval_seconds: 60 } });
  assert.deepEqual(validateAlarmForm('melody', ' 5 ', '600'),
    { ok: true, value: { ringtone: 'melody', duration_seconds: 5, interval_seconds: 600 } });
  assert.deepEqual(validateAlarmForm('classic', '120', '120'),
    { ok: true, value: { ringtone: 'classic', duration_seconds: 120, interval_seconds: 120 } });
});

test('validateAlarmForm explains every problem in Russian', () => {
  assert.deepEqual(validateAlarmForm('siren', '60', '60'), { ok: false, errors: [ALARM_ERRORS.ringtone] });
  for (const duration of ['4', '121', '6.5', '', 'abc', '-10', '1e2']) {
    assert.deepEqual(validateAlarmForm('classic', duration, '600'), { ok: false, errors: [ALARM_ERRORS.duration] }, duration);
  }
  for (const interval of ['29', '601', '60.5', '']) {
    assert.deepEqual(validateAlarmForm('classic', '30', interval), { ok: false, errors: [ALARM_ERRORS.interval] }, interval);
  }
  assert.deepEqual(validateAlarmForm('classic', '90', '60'), { ok: false, errors: [ALARM_ERRORS.order] });
  assert.equal(ALARM_ERRORS.order, 'Длительность сигнала не может быть больше интервала повторения');
  assert.ok(ALARM_ERRORS.duration.includes('от 5 до 120'));
});

test('alarmSettingsOrDefault keeps a valid saved alarm and falls back for an old Lambda', () => {
  assert.deepEqual(alarmSettingsOrDefault({ ringtone: 'pulse', duration_seconds: 30, interval_seconds: 90 }),
    { ringtone: 'pulse', duration_seconds: 30, interval_seconds: 90 });
  for (const raw of [undefined, null, {}, { ringtone: 'pulse', duration_seconds: 300, interval_seconds: 90 }]) {
    assert.deepEqual(alarmSettingsOrDefault(raw), DEFAULT_PHARMACY_ALARM);
  }
  assert.deepEqual(DEFAULT_PHARMACY_ALARM, { ringtone: 'classic', duration_seconds: 60, interval_seconds: 60 });
  assert.equal(PREVIEW_SECONDS, 5);
});

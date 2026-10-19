import assert from 'node:assert/strict';
import test from 'node:test';

import { PHARMACY_ALARM_SECONDS, schedulePharmacyAlarm } from '../src/lib/pharmacy-alarm.ts';

test('one-minute pharmacy alarm schedules bounded chimes and can be stopped early', () => {
  const stops: number[] = [];
  let disconnected = 0;
  const context = {
    currentTime: 100,
    destination: {},
    createOscillator: () => ({
      type: '', frequency: { value: 0 },
      connect: (gain: unknown) => ({ connect: () => gain }),
      start: () => undefined, stop: (at?: number) => { if (at !== undefined) stops.push(at); },
      disconnect: () => { disconnected += 1; },
    }),
    createGain: () => ({
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: () => ({}), disconnect: () => { disconnected += 1; },
    }),
  } as unknown as AudioContext;
  const stop = schedulePharmacyAlarm(context);
  assert.equal(PHARMACY_ALARM_SECONDS, 60);
  assert.equal(stops.length, 52);
  assert.ok(stops.every((at) => at > 100 && at <= 160));
  assert.ok(Math.max(...stops) > 159);
  stop();
  assert.equal(disconnected, 104);
});

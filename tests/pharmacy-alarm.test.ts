import assert from 'node:assert/strict';
import test from 'node:test';

import { PHARMACY_ALARM_BEATS, PHARMACY_ALARM_SECONDS, schedulePharmacyAlarm } from '../src/lib/pharmacy-alarm.ts';

function fakeContext(stops: number[], starts: number[], counter: { disconnected: number }) {
  return {
    currentTime: 100,
    destination: {},
    createOscillator: () => ({
      type: '', frequency: { value: 0 },
      connect: (gain: unknown) => ({ connect: () => gain }),
      start: (at: number) => { starts.push(at); },
      stop: (at?: number) => { if (at !== undefined) stops.push(at); },
      disconnect: () => { counter.disconnected += 1; },
    }),
    createGain: () => ({
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: () => ({}), disconnect: () => { counter.disconnected += 1; },
    }),
  } as unknown as AudioContext;
}

test('the pharmacy alarm lasts ten seconds and every oscillator stops within it', () => {
  const stops: number[] = [];
  const starts: number[] = [];
  const counter = { disconnected: 0 };
  const stop = schedulePharmacyAlarm(fakeContext(stops, starts, counter));
  assert.equal(PHARMACY_ALARM_SECONDS, 10);
  assert.equal(stops.length, PHARMACY_ALARM_BEATS.length * 4);
  assert.equal(stops.length, 32);
  assert.ok(starts.every((at) => at >= 100 && at < 110));
  assert.ok(stops.every((at) => at > 100 && at <= 100 + PHARMACY_ALARM_SECONDS));
  // It really fills the ten seconds (the last chime ends in the last second).
  assert.ok(Math.max(...stops) > 109);
  stop();
  assert.equal(counter.disconnected, 64);
});

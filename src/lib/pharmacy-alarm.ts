/**
 * Job 014: the pharmacy alarm. Four ringtones generated with Web Audio in code (no audio files, nothing
 * copyrighted). Each ringtone is a short pattern repeated to fill the owner's duration; every note ends
 * at or before `start + seconds`. The owner picks the ringtone, the duration and the repeat interval on
 * the admin page «Уведомления заказов»; the pharmacy queue returns them as `alarm`.
 */

export type RingtoneId = 'classic' | 'bell' | 'pulse' | 'melody';

export const RINGTONES: ReadonlyArray<{ id: RingtoneId; label: string }> = [
  { id: 'classic', label: 'Классический' },
  { id: 'bell', label: 'Колокол' },
  { id: 'pulse', label: 'Пульс' },
  { id: 'melody', label: 'Мелодия' },
];

export const DEFAULT_RINGTONE: RingtoneId = 'classic';
/** Bounds shared with the Lambda (`backend/v1/shared/order_notification_settings.py`). */
export const ALARM_DURATION_MIN = 5;
export const ALARM_DURATION_MAX = 120;
export const ALARM_INTERVAL_MIN = 30;
export const ALARM_INTERVAL_MAX = 600;
export const DEFAULT_ALARM_SECONDS = 60;
export const DEFAULT_ALARM_INTERVAL_SECONDS = 60;
/** Length of the «Прослушать» preview on the admin page. */
export const PREVIEW_SECONDS = 5;
/** Loudest note level (moderate on purpose: the alarm can ring for a minute every minute). */
export const MAX_GAIN = 0.22;

export function isRingtone(value: unknown): value is RingtoneId {
  return typeof value === 'string' && RINGTONES.some((ringtone) => ringtone.id === value);
}

type Note = { frequency: number; offset: number; length: number; gain: number; wave: OscillatorType };
type Pattern = { period: number; notes: readonly Note[] };

const note = (frequency: number, offset: number, length: number, gain = MAX_GAIN, wave: OscillatorType = 'sine'): Note =>
  ({ frequency, offset, length, gain, wave });

/** One period of each ringtone (seconds). */
export const RINGTONE_PATTERNS: Readonly<Record<RingtoneId, Pattern>> = {
  // The job 013 chime: two quick high-low pairs every 1.25 s.
  classic: { period: 1.25, notes: [note(880, 0, 0.18), note(1320, 0.18, 0.18), note(880, 0.5, 0.18), note(1320, 0.68, 0.18)] },
  // A struck bell with a long decay, every 2 s.
  bell: { period: 2, notes: [note(660, 0, 1.4, MAX_GAIN, 'triangle'), note(990, 0, 1, 0.12), note(1320, 0, 0.6, 0.08)] },
  // Three short beeps, then a pause, every second.
  pulse: { period: 1, notes: [note(1000, 0, 0.1, 0.14, 'square'), note(1000, 0.2, 0.1, 0.14, 'square'), note(1000, 0.4, 0.1, 0.14, 'square')] },
  // A rising C-E-G-C phrase every 2.4 s.
  melody: { period: 2.4, notes: [note(523, 0, 0.25), note(659, 0.3, 0.25), note(784, 0.6, 0.25), note(1047, 0.9, 0.5)] },
};

/** Notes shorter than this at the end of the duration are skipped (they would only click). */
const MIN_NOTE = 0.05;

/**
 * Schedules `seconds` of the ringtone on `context` from now and returns a function that stops every
 * note at once. An unknown ringtone plays «Классический»; a non-finite or non-positive length plays the
 * default 60 s, and lengths are capped at ALARM_DURATION_MAX.
 */
export function schedulePharmacyAlarm(context: AudioContext, ringtone: RingtoneId | string = DEFAULT_RINGTONE,
  seconds: number = DEFAULT_ALARM_SECONDS): () => void {
  const pattern = RINGTONE_PATTERNS[isRingtone(ringtone) ? ringtone : DEFAULT_RINGTONE];
  const duration = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, ALARM_DURATION_MAX) : DEFAULT_ALARM_SECONDS;
  const start = context.currentTime;
  const limit = start + duration;
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  for (let beat = 0; beat < duration; beat += pattern.period) {
    for (const { frequency, offset, length, gain: level, wave } of pattern.notes) {
      const at = start + beat + offset;
      const end = Math.min(limit, at + length);
      if (end - at < MIN_NOTE) continue;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.min(level, MAX_GAIN), at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end - 0.01);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(end);
      oscillators.push(oscillator);
      gains.push(gain);
    }
  }
  return () => {
    for (const oscillator of oscillators) {
      try { oscillator.stop(); } catch { /* already finished */ }
      oscillator.disconnect();
    }
    for (const gain of gains) gain.disconnect();
  };
}

/**
 * Holds at most one playing alarm: `play` stops the previous alarm before starting the next one (a new
 * due alert replaces the ringing one instead of stacking on it), `stop` silences it.
 */
export function createAlarmSlot() {
  let stopCurrent: (() => void) | null = null;
  return {
    play(start: () => () => void) {
      stopCurrent?.();
      stopCurrent = null;
      stopCurrent = start();
    },
    stop() {
      stopCurrent?.();
      stopCurrent = null;
    },
    get playing() { return stopCurrent !== null; },
  };
}

/** The `pharmacy_alarm` object of the admin settings payload (snake case, as the Lambda stores it). */
export type PharmacyAlarmSettings = { ringtone: RingtoneId; duration_seconds: number; interval_seconds: number };

export const DEFAULT_PHARMACY_ALARM: PharmacyAlarmSettings = {
  ringtone: DEFAULT_RINGTONE, duration_seconds: DEFAULT_ALARM_SECONDS, interval_seconds: DEFAULT_ALARM_INTERVAL_SECONDS,
};

export const ALARM_ERRORS = {
  ringtone: 'Выберите мелодию из списка',
  duration: `Длительность сигнала — целое число от ${ALARM_DURATION_MIN} до ${ALARM_DURATION_MAX} секунд`,
  interval: `Повторять можно каждые ${ALARM_INTERVAL_MIN}–${ALARM_INTERVAL_MAX} секунд (целое число)`,
  order: 'Длительность сигнала не может быть больше интервала повторения',
} as const;

function wholeSeconds(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Admin form check before saving (the Lambda validates again): the ringtone is one of the four, the
 * duration and the interval are whole seconds within bounds, and the duration does not exceed the
 * interval. Returns the payload object or the Russian error messages.
 */
export function validateAlarmForm(ringtone: string, durationText: string, intervalText: string):
  { ok: true; value: PharmacyAlarmSettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const duration = wholeSeconds(durationText);
  const interval = wholeSeconds(intervalText);
  if (!isRingtone(ringtone)) errors.push(ALARM_ERRORS.ringtone);
  const durationOk = duration !== null && duration >= ALARM_DURATION_MIN && duration <= ALARM_DURATION_MAX;
  const intervalOk = interval !== null && interval >= ALARM_INTERVAL_MIN && interval <= ALARM_INTERVAL_MAX;
  if (!durationOk) errors.push(ALARM_ERRORS.duration);
  if (!intervalOk) errors.push(ALARM_ERRORS.interval);
  if (durationOk && intervalOk && duration! > interval!) errors.push(ALARM_ERRORS.order);
  if (errors.length || !isRingtone(ringtone)) return { ok: false, errors };
  return { ok: true, value: { ringtone, duration_seconds: duration!, interval_seconds: interval! } };
}

/** The saved alarm of the admin settings, or the defaults when an older Lambda did not return it. */
export function alarmSettingsOrDefault(value: unknown): PharmacyAlarmSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PHARMACY_ALARM };
  const raw = value as Record<string, unknown>;
  const checked = validateAlarmForm(String(raw.ringtone ?? ''), String(raw.duration_seconds ?? ''),
    String(raw.interval_seconds ?? ''));
  return checked.ok ? checked.value : { ...DEFAULT_PHARMACY_ALARM };
}

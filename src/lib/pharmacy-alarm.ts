/**
 * Job 013: a ten-second chime sequence played by both pharmacies on every due reminder, so the staff
 * notice a new order (the owner asked for a 10-second sound). Every note ends within
 * PHARMACY_ALARM_SECONDS of the start. Only called after the staff member enables sound (autoplay rules).
 */
export const PHARMACY_ALARM_SECONDS = 10;

/** Start of each chime group, in seconds from the start (a group lasts 0.86 s). */
export const PHARMACY_ALARM_BEATS: readonly number[] = [0, 1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75];

const NOTES: ReadonlyArray<readonly [number, number]> = [[880, 0], [1320, 0.18], [880, 0.5], [1320, 0.68]];
const NOTE_SECONDS = 0.18;

export function schedulePharmacyAlarm(context: AudioContext): () => void {
  const start = context.currentTime;
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  for (const beat of PHARMACY_ALARM_BEATS) {
    for (const [frequency, offset] of NOTES) {
      const at = start + beat + offset;
      const end = Math.min(start + PHARMACY_ALARM_SECONDS, at + NOTE_SECONDS);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
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

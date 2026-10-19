/** A one-minute sequence of short chimes. Only called after the staff member enables sound. */
export const PHARMACY_ALARM_SECONDS = 60;

export function schedulePharmacyAlarm(context: AudioContext): () => void {
  const start = context.currentTime;
  const oscillators: OscillatorNode[] = [];
  const gains: GainNode[] = [];
  const beats = Array.from({ length: 12 }, (_, index) => index * 5).concat(59);
  for (const beat of beats) {
    for (const [frequency, offset] of [[880, 0], [1320, 0.18], [880, 0.5], [1320, 0.68]]) {
      const at = start + beat + offset;
      const end = Math.min(start + PHARMACY_ALARM_SECONDS, at + 0.18);
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

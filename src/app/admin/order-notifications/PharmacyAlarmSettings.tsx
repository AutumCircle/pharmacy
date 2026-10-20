'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ALARM_DURATION_MAX, ALARM_DURATION_MIN, ALARM_INTERVAL_MAX, ALARM_INTERVAL_MIN, PREVIEW_SECONDS, RINGTONES,
  createAlarmSlot, isRingtone, schedulePharmacyAlarm,
} from '@/lib/pharmacy-alarm';

export type AlarmFormState = { ringtone: string; duration: string; interval: string };

/**
 * Job 014: the owner's alarm for «Ватан 1» and «Ватан 2» — ringtone, how long it rings and how often it
 * repeats while an order waits for «Сборка сделана». «Прослушать» plays five seconds of the chosen ringtone.
 */
export default function PharmacyAlarmSettingsForm({ value, errors, disabled, onChange }: {
  value: AlarmFormState; errors: string[]; disabled: boolean; onChange: (value: AlarmFormState) => void;
}) {
  const audio = useRef<AudioContext | null>(null);
  const slot = useRef(createAlarmSlot());
  const timer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const current = slot.current;
    return () => {
      current.stop();
      if (timer.current !== null) window.clearTimeout(timer.current);
      void audio.current?.close().catch(() => undefined);
    };
  }, []);

  function stop() {
    slot.current.stop();
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }

  function listen() {
    setNote('');
    try {
      if (!audio.current) {
        const Context = window.AudioContext
          || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) { setNote('Этот браузер не умеет воспроизводить звук.'); return; }
        audio.current = new Context();
      }
      const context = audio.current;
      void context.resume().catch(() => undefined);
      const ringtone = isRingtone(value.ringtone) ? value.ringtone : 'classic';
      slot.current.play(() => schedulePharmacyAlarm(context, ringtone, PREVIEW_SECONDS));
      setPlaying(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(stop, PREVIEW_SECONDS * 1000 + 200);
    } catch {
      setNote('Не удалось воспроизвести звук.');
    }
  }

  return <section className="notification-alarm" aria-labelledby="notification-alarm-title">
    <h2 id="notification-alarm-title">Сигнал в аптеках (Ватан 1 и Ватан 2)</h2>
    <p>Звучит на странице аптеки, пока заказ ждёт «Сборка сделана», и повторяется через заданный интервал.
      Длительность не может быть больше интервала.</p>
    <div className="notification-alarm-fields">
      <label><span>Мелодия</span>
        <select value={value.ringtone} disabled={disabled}
          onChange={(event) => { stop(); onChange({ ...value, ringtone: event.target.value }); }}>
          {RINGTONES.map((ringtone) => <option key={ringtone.id} value={ringtone.id}>{ringtone.label}</option>)}
        </select>
      </label>
      <div className="notification-alarm-listen">
        {playing
          ? <button type="button" onClick={stop}>Остановить</button>
          : <button type="button" onClick={listen} disabled={disabled}>Прослушать</button>}
      </div>
      <label><span>Длительность сигнала, сек</span>
        <input type="number" inputMode="numeric" min={ALARM_DURATION_MIN} max={ALARM_DURATION_MAX} step={1}
          value={value.duration} disabled={disabled}
          onChange={(event) => onChange({ ...value, duration: event.target.value })} />
        <small>от {ALARM_DURATION_MIN} до {ALARM_DURATION_MAX}</small>
      </label>
      <label><span>Повторять каждые, сек</span>
        <input type="number" inputMode="numeric" min={ALARM_INTERVAL_MIN} max={ALARM_INTERVAL_MAX} step={1}
          value={value.interval} disabled={disabled}
          onChange={(event) => onChange({ ...value, interval: event.target.value })} />
        <small>от {ALARM_INTERVAL_MIN} до {ALARM_INTERVAL_MAX}</small>
      </label>
    </div>
    {errors.length > 0 && <ul role="alert" className="error notification-alarm-errors">
      {errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    {note && <p role="status" className="notification-preview-muted">{note}</p>}
  </section>;
}

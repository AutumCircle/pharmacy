'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestLiveRefresh } from '@/components/LiveRefresh';

export type AlertOrder = { id: string; title: string; detail: string; href: string };

const SOUND_KEY = 'vatan-order-sound';

function readSoundPreference() {
  try { return window.localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}

function writeSoundPreference(value: boolean) {
  try { window.localStorage.setItem(SOUND_KEY, value ? '1' : '0'); } catch { /* private mode */ }
}

/** Two short rising tones; Web Audio needs no audio file and works offline. */
export function chime(context: AudioContext) {
  const start = context.currentTime;
  [[880, 0], [1320, 0.18], [880, 0.5], [1320, 0.68]].forEach(([frequency, offset]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.18);
  });
}

/**
 * Polls for new orders every 30 s. The first poll only remembers what already exists, so the
 * alert fires solely for orders that appear while the page is open.
 */
export default function NewOrderAlerts({ load, enabled = true }: { load: () => Promise<AlertOrder[]>; enabled?: boolean }) {
  const known = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const baseTitle = useRef<string>('');
  const [sound, setSound] = useState(false);
  const [fresh, setFresh] = useState<AlertOrder[]>([]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSound(readSoundPreference()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const unlock = useCallback(() => {
    if (!audio.current) {
      const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context) audio.current = new Context();
    }
    void audio.current?.resume();
  }, []);

  useEffect(() => {
    if (!sound) return;
    const handler = () => unlock();
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => { window.removeEventListener('pointerdown', handler); window.removeEventListener('keydown', handler); };
  }, [sound, unlock]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, '');
    async function poll() {
      let orders: AlertOrder[];
      try { orders = await load(); } catch { return; }
      if (cancelled) return;
      const ids = new Set(orders.map((order) => order.id));
      document.title = orders.length ? `(${orders.length}) ${baseTitle.current}` : baseTitle.current;
      if (known.current === null) { known.current = ids; return; }
      const arrived = orders.filter((order) => !known.current!.has(order.id));
      known.current = ids;
      if (!arrived.length) return;
      requestLiveRefresh();
      setFresh((current) => [...arrived, ...current].slice(0, 4));
      if (readSoundPreference() && audio.current) {
        try { await audio.current.resume(); chime(audio.current); } catch { /* blocked until the next tap */ }
      }
      if (readSoundPreference() && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        arrived.forEach((order) => new Notification(order.title, { body: order.detail, tag: order.id }));
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); document.title = baseTitle.current; };
  }, [enabled, load]);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    writeSoundPreference(next);
    if (next) {
      unlock();
      if (audio.current) chime(audio.current);
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    }
  }

  if (!enabled) return null;
  return <>
    <button type="button" className={sound ? 'noa-sound on' : 'noa-sound'} onClick={toggleSound}
      aria-pressed={sound} title={sound ? 'Звук новых заказов включён' : 'Включить звук новых заказов'}>
      <span aria-hidden="true">{sound ? '🔔' : '🔕'}</span>{!sound && <span className="noa-sound-label">Включить звук</span>}
    </button>
    {fresh.length > 0 && <div className="noa-stack" role="alert">
      {fresh.map((order) => <div key={order.id} className="noa-toast">
        <Link href={order.href} onClick={() => setFresh((current) => current.filter((item) => item.id !== order.id))}>
          <strong>{order.title}</strong><span>{order.detail}</span></Link>
        <button type="button" aria-label="Скрыть" onClick={() => setFresh((current) => current.filter((item) => item.id !== order.id))}>×</button>
      </div>)}
    </div>}
    <style>{`
      .noa-sound { position: fixed; z-index: 60; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); display: inline-flex; align-items: center; gap: 6px;
        padding: 10px 14px; border: 1px solid #d5dbd7; border-radius: 999px; background: #fff; color: #14201a; font: inherit; font-size: 14px; font-weight: 700;
        box-shadow: 0 6px 18px rgba(20,32,26,.14); cursor: pointer; }
      .noa-sound.on { border-color: #187a3c; color: #187a3c; }
      .noa-stack { position: fixed; z-index: 70; top: 16px; right: 16px; display: grid; gap: 8px; width: min(360px, calc(100vw - 32px)); }
      .noa-toast { display: flex; align-items: flex-start; gap: 8px; padding: 14px; border-radius: 14px; background: #14201a; color: #fff;
        box-shadow: 0 12px 30px rgba(0,0,0,.25); animation: noa-in .25s ease-out; }
      .noa-toast a { display: grid; gap: 3px; flex: 1; color: inherit; text-decoration: none; }
      .noa-toast strong { font-size: 15px; }
      .noa-toast span { color: #c9d2cc; font-size: 13px; }
      .noa-toast button { border: 0; background: none; color: #c9d2cc; font-size: 22px; line-height: 1; cursor: pointer; }
      @keyframes noa-in { from { transform: translateY(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
      @media (max-width: 700px) { .noa-sound-label { display: none; } }
    `}</style>
  </>;
}

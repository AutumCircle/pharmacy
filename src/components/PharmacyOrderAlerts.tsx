'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chime } from '@/components/NewOrderAlerts';
import { schedulePharmacyAlarm } from '@/lib/pharmacy-alarm';
import {
  PHARMACY_ONE_REMIND_MS, PHARMACY_SOUND_KEY, POLL_MS, REMIND_MS, SOUND_BLOCKED, SOUND_UNAVAILABLE,
  alertText, dueAlerts, soundClickAction, soundLabel,
  titleWithCount, type AlertQueueOrder,
} from '@/lib/pharmacy-alerts';
import { setAttentionCount } from '@/lib/pharmacy-alert-store';

type Toast = { id: string; title: string; body: string };

const MAX_TOASTS = 4;

function readSoundPreference() {
  try { return window.localStorage.getItem(PHARMACY_SOUND_KEY) === '1'; } catch { return false; }
}

function writeSoundPreference(value: boolean) {
  try { window.localStorage.setItem(PHARMACY_SOUND_KEY, value ? '1' : '0'); } catch { /* private mode */ }
}

async function loadQueue(): Promise<AlertQueueOrder[] | null> {
  try {
    // For a pharmacy session the Lambda returns this pharmacy's queue (first page, newest first).
    const response = await fetch('/api/staff/orders', { cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const rows = data && typeof data === 'object' ? (data as { data?: unknown }).data : null;
    return Array.isArray(rows) ? rows as AlertQueueOrder[] : null;
  } catch {
    return null;
  }
}

/**
 * On-screen signal and optional sound for orders this pharmacy has not
 * reacted to yet. Reaction is decided by the Lambda (`needs_attention`); an older Lambda without the
 * field gives no reminders. Works only while the page is open (Web Push is follow-up 012b).
 */
export default function PharmacyOrderAlerts({ enabled, intensive = false }: { enabled: boolean; intensive?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const lastAlerted = useRef(new Map<string, number>());
  const audio = useRef<AudioContext | null>(null);
  const stopAlarm = useRef<(() => void) | null>(null);
  const count = useRef(0);
  const [sound, setSound] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // A tap on the control did not get running audio: the next tap switches the sound off (no dead-end).
  const [unlockFailed, setUnlockFailed] = useState(false);
  const [soundNote, setSoundNote] = useState<string | null>(null);
  // Screen-reader announcement of newly due orders only (the toast minutes change every poll).
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSound(readSoundPreference()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  /** Creates/resumes the AudioContext; must run inside a tap or keypress (autoplay rules). */
  const unlock = useCallback((): { context: AudioContext; running: Promise<boolean> } | null => {
    try {
      if (!audio.current) {
        const Context = window.AudioContext
          || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return null;
        const context = new Context();
        context.onstatechange = () => setUnlocked(context.state === 'running');
        audio.current = context;
      }
      const context = audio.current;
      const running = context.resume().then(() => context.state === 'running', () => false);
      void running.then((ok) => setUnlocked(ok));
      return { context, running };
    } catch {
      return null;
    }
  }, []);

  // Preference on but no gesture yet (e.g. after a reload): unlock on the first tap or keypress.
  useEffect(() => {
    if (!enabled || !sound || unlocked) return;
    const handler = () => { unlock(); };
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('pointerdown', handler); window.removeEventListener('keydown', handler); };
  }, [enabled, sound, unlocked, unlock]);

  // Next.js resets the title on navigation; put the counter back.
  useEffect(() => {
    if (!enabled) return;
    document.title = titleWithCount(document.title, count.current);
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;
    async function poll() {
      if (busy) return;
      busy = true;
      try {
        const orders = await loadQueue();
        if (cancelled || !orders) return;
        const now = Date.now();
        const result = dueAlerts(orders, lastAlerted.current, now, intensive ? PHARMACY_ONE_REMIND_MS : REMIND_MS);
        lastAlerted.current = result.lastAlerted;
        const attention = new Map(orders.filter((order) => order.needs_attention === true)
          .map((order) => [order.order_id, order]));
        count.current = attention.size;
        if (attention.size === 0 && stopAlarm.current) { stopAlarm.current(); stopAlarm.current = null; }
        setAttentionCount(attention.size);
        document.title = titleWithCount(document.title, attention.size);
        const due = new Set(result.due);
        setToasts((current) => [
          ...result.due.map((id) => ({ id, ...alertText(attention.get(id)!, now) })),
          // Earlier toasts stay (with fresh minutes) until the order is reacted to or leaves the queue.
          ...current.filter((toast) => attention.has(toast.id) && !due.has(toast.id))
            .map((toast) => ({ id: toast.id, ...alertText(attention.get(toast.id)!, now) })),
        ]);
        if (!result.due.length) return;
        setAnnouncement(result.due.map((id) => alertText(attention.get(id)!, now).title).join('. '));
        const context = audio.current;
        if (readSoundPreference() && context && context.state === 'running') {
          try {
            if (intensive) {
              stopAlarm.current?.();
              stopAlarm.current = schedulePharmacyAlarm(context);
            } else chime(context);
          } catch { /* the on-screen signal is still shown */ }
        }
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          for (const id of result.due) {
            const text = alertText(attention.get(id)!, now);
            // Throws on Android Chrome without a service worker; reliable delivery is follow-up 012b.
            try { new Notification(text.title, { body: text.body, tag: `pharmacy-${id}` }); } catch { /* ignored */ }
          }
        }
      } finally {
        busy = false;
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stopAlarm.current?.();
      stopAlarm.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      setAttentionCount(null);
      count.current = 0;
      document.title = titleWithCount(document.title, 0);
    };
  }, [enabled, intensive]);

  function setPreference(value: boolean) {
    if (!value) { stopAlarm.current?.(); stopAlarm.current = null; }
    setSound(value);
    writeSoundPreference(value);
    setUnlockFailed(false);
  }

  /** This tap is the gesture: unlock, confirm with the chime, and report a failure instead of dead-ending. */
  function tryUnlock(): boolean {
    const audioState = unlock();
    if (!audioState) {
      setPreference(false);
      setSoundNote(SOUND_UNAVAILABLE);
      return false;
    }
    try { chime(audioState.context); } catch { /* blocked */ }
    void audioState.running.then((ok) => {
      setUnlockFailed(!ok);
      setSoundNote(ok ? null : SOUND_BLOCKED);
    });
    return true;
  }

  function onSoundClick() {
    const action = soundClickAction(sound, unlocked, unlockFailed);
    if (action === 'disable') {
      setPreference(false);
      setSoundNote(null);
      return;
    }
    if (action === 'enable') {
      setSoundNote(null);
      if (tryUnlock()) setPreference(true);
      return;
    }
    // «Нажмите, чтобы включить звук» after a reload.
    tryUnlock();
  }

  function dismiss(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  if (!enabled) return null;
  const label = soundLabel(sound, unlocked);
  return <>
    <button type="button" className={`pa-sound${sound ? (unlocked ? ' on' : ' wait') : ''}`} onClick={onSoundClick}
      // Keep the window-level unlock listener from flipping the state before this click is handled.
      onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
      title={sound && unlocked ? 'Нажмите, чтобы выключить звук' : label}>
      <span aria-hidden="true">{sound && unlocked ? '🔔' : '🔕'}</span><span>{label}</span>
    </button>
    {soundNote && <p className="pa-sound-note" role="status">{soundNote}</p>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {toasts.length > 0 && <div className="pa-stack">
      {toasts.slice(0, MAX_TOASTS).map((toast) => <div key={toast.id} className="pa-toast">
        <Link href="/staff/orders" onClick={() => { dismiss(toast.id); router.refresh(); }}>
          <strong>{toast.title}</strong><span>{toast.body}</span></Link>
        <button type="button" aria-label="Скрыть" onClick={() => dismiss(toast.id)}>×</button>
      </div>)}
      {toasts.length > MAX_TOASTS && <div className="pa-more">Ещё заказов: {toasts.length - MAX_TOASTS}</div>}
    </div>}
  </>;
}

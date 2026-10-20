'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chime } from '@/components/NewOrderAlerts';
import { createAlarmSlot, schedulePharmacyAlarm } from '@/lib/pharmacy-alarm';
import {
  DEFAULT_ALARM_CONFIG, PHARMACY_SOUND_KEY, POLL_MS, SOUND_UNAVAILABLE, UNLOCK_EVENTS,
  alertText, dueAlerts, parseAlarmConfig, remindIntervalMs, soundLabel, systemNotification,
  titleWithCount, type AlertQueueOrder, type PharmacyAlarmConfig,
} from '@/lib/pharmacy-alerts';
import { setAttentionCount } from '@/lib/pharmacy-alert-store';

type Toast = { id: string; title: string; body: string };

const MAX_TOASTS = 4;

async function loadQueue(): Promise<{ orders: AlertQueueOrder[]; alarm: PharmacyAlarmConfig } | null> {
  try {
    // For a pharmacy session the Lambda returns this pharmacy's queue (first page, newest first) and the
    // owner's alarm settings (`alarm`, job 014; missing on an older Lambda -> defaults).
    const response = await fetch('/api/staff/orders', { cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const document = data && typeof data === 'object' ? data as { data?: unknown; alarm?: unknown } : null;
    const rows = document ? document.data : null;
    return Array.isArray(rows) ? { orders: rows as AlertQueueOrder[], alarm: parseAlarmConfig(document?.alarm) } : null;
  } catch {
    return null;
  }
}

/**
 * Signal, sound and system notification for orders this pharmacy has not marked «Сборка сделана» yet
 * (the Lambda decides via `needs_attention`; an older Lambda without the field gives no reminders).
 *
 * Job 014: sound is always on. The AudioContext is created on mount and resumed straight away (an
 * installed app or a site allowed to play sound starts at once); otherwise the first touch or key press
 * anywhere on the page unlocks it. Each due reminder plays the owner's ringtone for the owner's duration
 * and repeats at the owner's interval (default 60 s every 60 s, the same for «Ватан 1» and «Ватан 2»);
 * a new one replaces the ringing alarm. When notifications are allowed, every due reminder also shows a
 * system notification (its own OS sound needs no gesture), whether the page is visible or hidden.
 * Works only while the page is open (closed-app notifications are the Web Push backlog).
 */
export default function PharmacyOrderAlerts({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const lastAlerted = useRef(new Map<string, number>());
  const audio = useRef<AudioContext | null>(null);
  const alarm = useRef(createAlarmSlot());
  const config = useRef<PharmacyAlarmConfig>(DEFAULT_ALARM_CONFIG);
  const count = useRef(0);
  // An alarm came due while the browser still blocked audio: play it as soon as audio unlocks.
  const pendingAlarm = useRef(false);
  const [running, setRunning] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Screen-reader announcement of newly due orders only (the toast minutes change every poll).
  const [announcement, setAnnouncement] = useState('');

  /** Creates (once) and resumes the AudioContext. Without a gesture the browser may keep it suspended. */
  const resume = useCallback((): AudioContext | null => {
    try {
      if (!audio.current) {
        const Context = window.AudioContext
          || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) { setUnavailable(true); return null; }
        const context = new Context();
        context.onstatechange = () => setRunning(context.state === 'running');
        audio.current = context;
      }
      const context = audio.current;
      if (context.state !== 'running') {
        void context.resume().then(() => setRunning(context.state === 'running'), () => undefined);
      } else {
        setRunning(true);
      }
      return context;
    } catch {
      setUnavailable(true);
      return null;
    }
  }, []);

  // On mount: sound is on (an old '0' from before job 014 no longer switches it off) and audio is tried at once.
  useEffect(() => {
    if (!enabled) return;
    try { window.localStorage.setItem(PHARMACY_SOUND_KEY, '1'); } catch { /* private mode */ }
    const frame = window.requestAnimationFrame(() => { resume(); });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, resume]);

  // Still blocked (an ordinary tab after a reload): the first touch or key press anywhere unlocks it.
  useEffect(() => {
    if (!enabled || running || unavailable) return;
    const handler = () => { resume(); };
    for (const name of UNLOCK_EVENTS) window.addEventListener(name, handler, { capture: true, passive: true });
    return () => { for (const name of UNLOCK_EVENTS) window.removeEventListener(name, handler, { capture: true }); };
  }, [enabled, running, unavailable, resume]);

  useEffect(() => {
    const context = audio.current;
    if (!running || !pendingAlarm.current || !context || context.state !== 'running') return;
    pendingAlarm.current = false;
    if (count.current === 0) return;
    const { ringtone, durationSeconds } = config.current;
    try { alarm.current.play(() => schedulePharmacyAlarm(context, ringtone, durationSeconds)); } catch { /* signal still shown */ }
  }, [running]);

  // Next.js resets the title on navigation; put the counter back.
  useEffect(() => {
    if (!enabled) return;
    document.title = titleWithCount(document.title, count.current);
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;
    const slot = alarm.current;
    async function poll() {
      if (busy) return;
      busy = true;
      try {
        const queue = await loadQueue();
        if (cancelled || !queue) return;
        const { orders } = queue;
        config.current = queue.alarm;
        const now = Date.now();
        const result = dueAlerts(orders, lastAlerted.current, now, remindIntervalMs(config.current));
        lastAlerted.current = result.lastAlerted;
        const attention = new Map(orders.filter((order) => order.needs_attention === true)
          .map((order) => [order.order_id, order]));
        count.current = attention.size;
        // Nothing waits for «Сборка сделана» any more: silence at once.
        if (attention.size === 0) { slot.stop(); pendingAlarm.current = false; }
        setAttentionCount(attention.size);
        document.title = titleWithCount(document.title, attention.size);
        const due = new Set(result.due);
        setToasts((current) => [
          ...result.due.map((id) => ({ id, ...alertText(attention.get(id)!, now) })),
          // Earlier toasts stay (with fresh minutes) until the order is assembled or leaves the queue.
          ...current.filter((toast) => attention.has(toast.id) && !due.has(toast.id))
            .map((toast) => ({ id: toast.id, ...alertText(attention.get(toast.id)!, now) })),
        ]);
        if (!result.due.length) return;
        setAnnouncement(result.due.map((id) => alertText(attention.get(id)!, now).title).join('. '));
        const context = audio.current;
        if (context && context.state !== 'running') void context.resume().catch(() => undefined);
        pendingAlarm.current = !context || context.state !== 'running';
        if (context && context.state === 'running') {
          const { ringtone, durationSeconds } = config.current;
          // A new due reminder stops the previous alarm instead of stacking on it.
          try { slot.play(() => schedulePharmacyAlarm(context, ringtone, durationSeconds)); } catch { /* signal still shown */ }
        }
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const id of result.due) {
            const notification = systemNotification(attention.get(id)!, now);
            // Throws on Android Chrome without a service worker; the toast and the title still work there.
            try { new Notification(notification.title, notification.options as NotificationOptions); } catch { /* ignored */ }
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
      slot.stop();
      document.removeEventListener('visibilitychange', onVisible);
      setAttentionCount(null);
      count.current = 0;
      document.title = titleWithCount(document.title, 0);
    };
  }, [enabled]);

  /** The control is only a status indicator; a tap on it is one more touch that unlocks audio. */
  function onSoundClick() {
    const context = resume();
    if (context && context.state === 'running') {
      try { chime(context); } catch { /* blocked */ }
    }
  }

  function dismiss(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  if (!enabled) return null;
  const label = soundLabel(running);
  return <>
    <button type="button" className={`pa-sound${running ? ' on' : ' wait'}`} onClick={onSoundClick} title={label}>
      <span aria-hidden="true">🔔</span><span>{label}</span>
    </button>
    <span className="sr-only" role="status" aria-live="polite">{label}</span>
    {unavailable && <p className="pa-sound-note" role="status">{SOUND_UNAVAILABLE}</p>}
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

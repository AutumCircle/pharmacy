'use client';

import { useEffect, useState } from 'react';
import { waitingLevel, waitingMinutes } from '@/lib/pharmacy-order';

const REFRESH_MS = 30_000;

/** «Ожидает обработки N мин» badge; re-renders every 30 s without a page reload. */
export default function WaitingMinutes({ since, initialNow }: { since: string; initialNow: number }) {
  // Start from the server's clock so the hydrated markup matches, then switch to the device clock.
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  let minutes: number;
  try {
    minutes = waitingMinutes(since, now);
  } catch {
    return null;
  }
  return <span className={`pharmacy-waiting ${waitingLevel(minutes)}`} role="status">
    Ожидает обработки {minutes} мин
  </span>;
}

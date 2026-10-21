'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { LIVE_REFRESH_MS, isEditingElement, shouldRefresh } from '@/lib/live-refresh';

/** Event that asks every mounted LiveRefresh to refresh now (e.g. the pharmacy alerts found a new order). */
export const LIVE_REFRESH_EVENT = 'vatan:live-refresh';

export function requestLiveRefresh() {
  try { window.dispatchEvent(new Event(LIVE_REFRESH_EVENT)); } catch { /* not in a browser */ }
}

/**
 * Re-renders the current server page every `intervalMs` while the tab is visible, at once when the tab
 * comes back or the network returns, and on `requestLiveRefresh()`. Client state (open editors, typed
 * text) survives `router.refresh()`; the refresh waits while focus is in a text field.
 */
export default function LiveRefresh({ intervalMs = LIVE_REFRESH_MS }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);

  useEffect(() => { pendingRef.current = pending; }, [pending]);

  useEffect(() => {
    const refresh = () => {
      if (!shouldRefresh({
        visible: document.visibilityState === 'visible',
        pending: pendingRef.current,
        editing: isEditingElement(document.activeElement as HTMLInputElement | null),
      })) return;
      startTransition(() => router.refresh());
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(refresh, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    window.addEventListener(LIVE_REFRESH_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      window.removeEventListener(LIVE_REFRESH_EVENT, refresh);
    };
  }, [router, intervalMs]);

  return null;
}

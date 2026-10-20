'use client';

import { useEffect, useState } from 'react';
import { SOUND_HINT, permissionView, type PermissionInput } from '@/lib/pharmacy-alerts';

function readInput(): PermissionInput {
  const supported = 'Notification' in window;
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try { standalone = standalone || window.matchMedia('(display-mode: standalone)').matches; } catch { /* old browser */ }
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return { supported, permission: supported ? Notification.permission : undefined, standalone, ios };
}

/** Job 012: whether this device can show system notifications and what to do if it cannot. */
export default function NotificationPermission() {
  const [input, setInput] = useState<PermissionInput | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const refresh = () => setInput(readInput());
    const frame = window.requestAnimationFrame(refresh);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  if (!input) return null;
  const view = permissionView(input);

  async function request() {
    // Only from this tap: browsers ignore or block permission prompts without a user gesture.
    if (!('Notification' in window)) return;
    setAsking(true);
    try { await Notification.requestPermission(); } catch { /* old Safari: callback form or blocked */ }
    setAsking(false);
    setInput(readInput());
  }

  return <section className={`pa-permission ${view.state}`} aria-label="Уведомления на этом устройстве">
    <div className="pa-permission-row">
      <strong>{view.text}</strong>
      {view.canRequest && <button type="button" onClick={request} disabled={asking}>Разрешить уведомления</button>}
    </div>
    <p>{view.installed}</p>
    {view.iosHint && <p className="pa-permission-hint">{view.iosHint}</p>}
    <p className="pa-permission-sound">{SOUND_HINT}</p>
    <p className="pa-permission-note">Сигнал и звук работают, пока эта страница открыта. При выключенном экране
      и в режиме энергосбережения напоминания могут не приходить.</p>
  </section>;
}

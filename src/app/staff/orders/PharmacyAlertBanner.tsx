'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore, useTransition } from 'react';
import { getAttentionCount, getServerAttentionCount, subscribeAttentionCount } from '@/lib/pharmacy-alert-store';
import { attentionBannerText } from '@/lib/pharmacy-alerts';

/**
 * «Заказов ждут «Собран»: N» at the top of the pharmacy queue (job 013). Starts from the server-rendered
 * count and follows the live count of PharmacyOrderAlerts (30 s poll) after that.
 */
export default function PharmacyAlertBanner({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const live = useSyncExternalStore(subscribeAttentionCount, getAttentionCount, getServerAttentionCount);
  const count = live ?? initialCount;
  const text = attentionBannerText(count);
  if (!text) return null;
  return <div className="pa-banner" role="status">
    <strong>{text}</strong>
    <button type="button" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
      {refreshing ? 'Обновляю…' : 'Показать'}</button>
  </div>;
}

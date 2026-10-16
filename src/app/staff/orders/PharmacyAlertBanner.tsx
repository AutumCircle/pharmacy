'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { getAttentionCount, getServerAttentionCount, subscribeAttentionCount } from '@/lib/pharmacy-alert-store';

/**
 * «Новых заказов без ответа: N» at the top of the pharmacy queue. Starts from the server-rendered
 * count and follows the live count of PharmacyOrderAlerts (30 s poll) after that.
 */
export default function PharmacyAlertBanner({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const live = useSyncExternalStore(subscribeAttentionCount, getAttentionCount, getServerAttentionCount);
  const count = live ?? initialCount;
  if (count <= 0) return null;
  return <div className="pa-banner" role="status">
    <strong>Новых заказов без ответа: {count}</strong>
    <button type="button" onClick={() => router.refresh()}>Показать</button>
  </div>;
}

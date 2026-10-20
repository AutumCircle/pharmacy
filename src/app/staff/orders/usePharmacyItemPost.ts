'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Shared POST for the pharmacy per-item controls (job 011 rework 1 «Ватан 2» routed items, job 013
 * «Ватан 1» row actions): sends one item request to the same-origin staff route, shows the Lambda's
 * Russian message on 403/404/409 (and refreshes, the state changed), refreshes on success.
 */
export function usePharmacyItemPost(orderId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to a new error so keyboard and screen-reader users land on it.
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function post(path: 'pharmacy-answers' | 'assembly/items', body: unknown, id: number): Promise<boolean> {
    setBusy(id); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(orderId)}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message || (response.status === 409 ? 'Состояние изменилось — карточка обновлена.'
          : response.status === 403 ? 'Эта позиция уже у другой аптеки.'
          : 'Не удалось сохранить. Повторите попытку.'));
        if ([403, 404, 409].includes(response.status)) router.refresh();
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Нет связи. Повторите попытку.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, setError, errorRef, post };
}

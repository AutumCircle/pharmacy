'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PharmacyAssemblyState } from '@/lib/api-v1/staff-types';
import { assemblyChip, nextAssemblyAction, validateAssemblyRequest } from '@/lib/pharmacy-assembly';

/**
 * «Начать сборку» -> «Собран» on a confirmed order card (job 011). Shows this pharmacy's current mark
 * chip and the next action. The browser sends only the target state; Lambda takes the pharmacy id from
 * the session and decides whether the mark is allowed. After success or a 409 the card is refreshed.
 */
export default function PharmacyAssemblyButtons({ orderId, state }: {
  orderId: string; state: PharmacyAssemblyState | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const action = nextAssemblyAction({ assembly_available: true, assembly_state: state });
  const chip = assemblyChip(state);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(target: PharmacyAssemblyState) {
    const checked = validateAssemblyRequest({ state: target });
    if (!checked.ok) { setError(checked.error); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(orderId)}/assembly`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checked.value),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const fallback = response.status === 409 ? 'Отметка уже изменилась — карточка обновлена.'
          : response.status === 404 ? 'Заказ не найден.'
          : 'Не удалось сохранить отметку. Повторите попытку.';
        setError(result?.error?.message || fallback);
        if ([404, 409].includes(response.status)) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError('Нет связи. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="pa-actions pa-assembly">
    <span className="pa-assembly-mark">Сборка: <span className={`pa-chip pa-tone-${chip.tone}`}>{chip.text}</span></span>
    {action && <button type="button" className={`pa-btn ${action.state === 'assembled' ? 'pa-btn-ok' : 'pa-btn-start'}`}
      disabled={busy} onClick={() => void submit(action.state)}>
      {busy ? 'Сохраняем…' : action.label}</button>}
    {error && <p className="pa-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
  </div>;
}

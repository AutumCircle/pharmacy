'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PharmacyAssemblyState } from '@/lib/api-v1/staff-types';
import { assemblyChip, nextAssemblyAction, validateAssemblyRequest } from '@/lib/pharmacy-assembly';

/**
 * Job 015: the one «Собран» button under the pharmacy table, the same for «Ватан 1» and «Ватан 2», with this
 * pharmacy's chip. One tap, no extra confirmation: everything not marked «Нет в наличии» counts as available.
 * After «Собран» only the chip («Собран») remains and the rows are read-only. The browser sends only
 * {state: 'assembled'}; Lambda takes the pharmacy id from the session and decides whether the mark is
 * allowed. After success or a 404/409 the card is refreshed.
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
    {action && <button type="button" className="pa-btn pa-btn-ok pa-btn-assembled"
      disabled={busy} onClick={() => void submit(action.state)}>
      {busy ? 'Сохраняем…' : action.label}</button>}
    {error && <p className="pa-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
  </div>;
}

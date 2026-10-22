'use client';

import { useState } from 'react';

/** «Нет в наличии» / «Вернуть в продажу»: the owner's mark that hides a medicine from clients. */
export default function MedicineVisibilityToggle({ medicineId, initialHidden }: {
  medicineId: number; initialHidden: boolean;
}) {
  const [hidden, setHidden] = useState(initialHidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    const next = !hidden;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/medicines/${medicineId}/visibility`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden_from_clients: next }),
      });
      if (!response.ok) throw new Error();
      setHidden(next);
    } catch {
      setError('Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-visibility">
    {hidden && <span className="admin-stock-badge out-of-stock">Скрыто от клиентов</span>}
    <button type="button" className={hidden ? 'admin-visibility-show' : 'admin-visibility-hide'}
      onClick={toggle} disabled={busy} aria-pressed={hidden}>
      {busy ? 'Сохраняю…' : hidden ? 'Вернуть в продажу' : 'Нет в наличии'}
    </button>
    {error && <small role="alert">{error}</small>}
  </div>;
}

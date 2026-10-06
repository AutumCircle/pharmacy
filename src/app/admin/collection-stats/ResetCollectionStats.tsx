'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resetCollectionStats } from './actions';

const CONFIRMATION = 'СБРОСИТЬ';

export default function ResetCollectionStats() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    if (confirmation !== CONFIRMATION) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await resetCollectionStats(confirmation);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMessage(
        `История обнулена: удалено событий — ${result.events_deleted}, очищено источников заказов — ${result.orders_attribution_cleared}.`,
      );
      setConfirmation('');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <section className="admin-reset-stats" aria-labelledby="reset-stats-title">
      <div>
        <h2 id="reset-stats-title">Тестовая история</h2>
        <p>Обнуляет открытия, клики, добавления в корзину и UTM-источники. Заказы, товары и подборки не удаляются.</p>
      </div>
      {!open ? (
        <button className="admin-danger-button" type="button" onClick={() => { setOpen(true); setMessage(null); }}>
          Обнулить историю
        </button>
      ) : (
        <div className="admin-reset-stats__confirmation">
          <label htmlFor="reset-stats-confirmation">
            Для подтверждения введите <strong>{CONFIRMATION}</strong>
          </label>
          <div className="admin-reset-stats__controls">
            <input
              id="reset-stats-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              disabled={pending}
            />
            <button
              className="admin-danger-button"
              type="button"
              disabled={pending || confirmation !== CONFIRMATION}
              onClick={reset}
            >
              {pending ? 'Обнуление…' : 'Подтвердить обнуление'}
            </button>
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setConfirmation(''); setError(null); }}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {message && <p className="admin-reset-stats__success" role="status">{message}</p>}
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
    </section>
  );
}

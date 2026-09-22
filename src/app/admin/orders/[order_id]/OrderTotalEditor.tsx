'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderTotal } from '../actions';

export default function OrderTotalEditor({
  orderId,
  initialTotal,
  currency,
}: {
  orderId: string;
  initialTotal: number;
  currency: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialTotal.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const total = Number(value.replace(',', '.'));
    setSaving(true);
    setMessage(null);
    setError(null);
    const result = await updateOrderTotal(orderId, total);
    if (result.success) {
      setValue(result.orderTotal.toFixed(2));
      setMessage('Цена заказа обновлена');
      router.refresh();
    } else {
      setError(result.error);
    }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} style={{ margin: '18px 0 8px' }}>
      <label htmlFor="order-total" style={{ display: 'block', fontWeight: 700, marginBottom: 7 }}>
        Итоговая цена заказа
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          id="order-total"
          type="number"
          min="0.01"
          max="10000000"
          step="0.01"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={{ width: 180, minHeight: 42, border: '1px solid #d0d5dd', borderRadius: 8, padding: '8px 10px', font: 'inherit' }}
        />
        <strong>{currency}</strong>
        <button type="submit" className="admin-primary-button" disabled={saving}>
          {saving ? 'Сохранение…' : 'Изменить цену'}
        </button>
      </div>
      {message && <p style={{ marginTop: 7, color: '#16803a' }}>{message}</p>}
      {error && <p style={{ marginTop: 7, color: '#c62828' }}>{error}</p>}
    </form>
  );
}

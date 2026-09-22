'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderItemPrice } from '../actions';

export default function OrderItemPriceEditor({ orderId, orderItemId, initialPrice }: { orderId: string; orderItemId: number; initialPrice: number }) {
  const router = useRouter();
  const [value, setValue] = useState(initialPrice.toFixed(2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await updateOrderItemPrice(orderId, orderItemId, Number(value.replace(',', '.')));
    if (result.success) {
      setValue(result.sellingUnitPrice.toFixed(2));
      router.refresh();
    } else setError(result.error);
    setSaving(false);
  };

  return (
    <form onSubmit={submit} style={{ minWidth: 210 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input aria-label="Цена продажи" type="number" min="0.01" max="10000000" step="0.01" required value={value} onChange={(event) => setValue(event.target.value)} style={{ width: 105, minHeight: 38, border: '1px solid #d0d5dd', borderRadius: 8, padding: '6px 8px', font: 'inherit' }} />
        <span>с.</span>
        <button type="submit" className="admin-primary-button" disabled={saving} style={{ minHeight: 38, padding: '6px 12px' }}>{saving ? '…' : 'Сохранить'}</button>
      </div>
      {error && <small style={{ display: 'block', marginTop: 5, color: '#c62828' }}>{error}</small>}
    </form>
  );
}

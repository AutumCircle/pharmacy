'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setOrderItemQuantity } from '../actions';
import type { OrderStatus } from '@/lib/api-v1/types';

export default function OrderItemQuantityEditor({ orderId, itemId, name, initialQuantity, status }: {
  orderId: string; itemId: number; name: string; initialQuantity: number; status: OrderStatus;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(initialQuantity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next: number) {
    if (next === initialQuantity) return;
    if (next === 0 && !window.confirm(`Удалить «${name}» только из этого заказа? Лекарство в каталоге останется.`)) return;
    if (status === 'delivered' && !window.confirm('Заказ уже доставлен. Его сумма изменится задним числом. Продолжить?')) return;
    if (status === 'cancelled' && !window.confirm('Заказ отменён. Изменить его состав для истории? Статус останется отменённым.')) return;
    setBusy(true); setError('');
    const result = await setOrderItemQuantity(orderId, itemId, initialQuantity, next);
    if (result.success) router.refresh();
    else setError(result.error);
    setBusy(false);
  }

  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
    <input aria-label={`Количество: ${name}`} type="number" min={1} max={99} value={quantity}
      onChange={(event) => setQuantity(Number(event.target.value))} disabled={busy}
      style={{ width: 66, minHeight: 40, padding: 6 }} />
    <button type="button" disabled={busy || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || quantity === initialQuantity}
      onClick={() => void change(quantity)}>Сохранить</button>
    <button type="button" disabled={busy} onClick={() => void change(0)} aria-label={`Удалить ${name} из заказа`}>Удалить</button>
    {error && <small role="alert" style={{ color: '#c62828', flexBasis: '100%' }}>{error}</small>}
  </div>;
}

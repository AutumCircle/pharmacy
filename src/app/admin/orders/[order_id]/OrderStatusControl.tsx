'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@/lib/api-v1/types';
import { updateOrderStatus } from '../actions';

const labels: Record<OrderStatus, string> = {
  pending: 'Новый',
  confirmed: 'Подтверждён',
  delivering: 'Доставляется',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivering', 'cancelled'],
  delivering: ['delivered'],
  delivered: [],
  cancelled: [],
};

export default function OrderStatusControl({ orderId, currentStatus }: {
  orderId: string;
  currentStatus: OrderStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeStatus = async (next: OrderStatus) => {
    let reason: string | undefined;
    if (next === 'cancelled') {
      reason = window.prompt('Укажите причину отмены')?.trim();
      if (!reason) return;
    }
    setPending(true);
    setError(null);
    const result = await updateOrderStatus(orderId, next, status, reason);
    if (result.success) {
      setStatus(next);
      router.refresh();
    } else {
      setError(result.error || 'Не удалось изменить статус');
    }
    setPending(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong>{labels[status]}</strong>
      {transitions[status].map((next) => (
        <button key={next} type="button" disabled={pending} onClick={() => changeStatus(next)}>
          {next === 'cancelled' ? 'Отменить заказ' : `Перевести: ${labels[next]}`}
        </button>
      ))}
      {error && <span style={{ color: '#c62828' }}>{error}</span>}
    </div>
  );
}

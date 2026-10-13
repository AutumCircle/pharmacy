'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@/lib/api-v1/types';
import { updateOrderStatus } from '../actions';
import { statusLabels } from '../ui';

const flow: OrderStatus[] = ['pending', 'confirmed', 'delivering', 'delivered'];
const nextStep: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: 'confirmed', label: 'Принять заказ' },
  confirmed: { status: 'delivering', label: 'Передать в доставку' },
  delivering: { status: 'delivered', label: 'Отметить доставленным' },
};

export default function OrderStatusControl({ orderId, currentStatus }: { orderId: string; currentStatus: OrderStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const step = nextStep[currentStatus];
  const index = flow.indexOf(currentStatus);

  async function change(next: OrderStatus, cancelReason?: string) {
    setPending(true); setError(null);
    const result = await updateOrderStatus(orderId, next, currentStatus, cancelReason);
    if (result.success) { setCancelling(false); setReason(''); router.refresh(); }
    else setError(result.error || 'Не удалось изменить статус');
    setPending(false);
  }

  return <section className="od-card od-o1">
    <div className="od-card-head"><h2>Статус</h2><span className={`ao-status ao-status-${currentStatus}`}>{statusLabels[currentStatus]}</span></div>
    {currentStatus === 'cancelled' ? <p className="od-muted">Заказ отменён.</p>
      : <ol className="od-progress">{flow.map((status, position) => <li key={status}
        className={position < index ? 'done' : position === index ? 'current' : ''}><span />{statusLabels[status]}</li>)}</ol>}
    {error && <p className="od-error" role="alert">{error}</p>}
    {cancelling ? <div className="od-form">
      <label>Причина отмены<textarea rows={2} maxLength={300} value={reason} autoFocus onChange={(event) => setReason(event.target.value)}
        placeholder="Например: клиент не отвечает" /></label>
      <div className="od-actions">
        <button type="button" className="ao-btn ao-btn-danger" disabled={pending || !reason.trim()}
          onClick={() => void change('cancelled', reason.trim())}>{pending ? '…' : 'Отменить заказ'}</button>
        <button type="button" className="ao-btn ao-btn-ghost" disabled={pending} onClick={() => setCancelling(false)}>Назад</button>
      </div>
    </div> : step && <div className="od-actions">
      <button type="button" className="ao-btn ao-btn-primary od-grow" disabled={pending} onClick={() => void change(step.status)}>
        {pending ? 'Сохраняем…' : step.label}</button>
      <button type="button" className="ao-btn ao-btn-ghost" disabled={pending} onClick={() => setCancelling(true)}>Отменить</button>
    </div>}
  </section>;
}

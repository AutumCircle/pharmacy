'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@/lib/api-v1/types';
import type { OrderStage } from '@/lib/order-stage';
import { ORDER_STAGE_LABELS, TRACKING_STEPS, trackingStepIndex } from '@/lib/order-stage';
import { updateOrderStatus } from '../actions';
import { stageChip } from '../ui';

const nextStep: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: 'confirmed', label: 'Подтвердить заказ' },
  confirmed: { status: 'delivering', label: 'Передать в доставку' },
  delivering: { status: 'delivered', label: 'Отметить доставленным' },
};

/** Job 013: the progress shows the same five stages as the client and the courier (`stage` from Lambda). */
export default function OrderStatusControl({ orderId, currentStatus, stage }: {
  orderId: string; currentStatus: OrderStatus; stage?: OrderStage;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const step = nextStep[currentStatus];
  const index = trackingStepIndex({ stage, status: currentStatus });
  const chip = stageChip({ status: currentStatus, stage });

  async function change(next: OrderStatus, cancelReason?: string) {
    setPending(true); setError(null);
    const result = await updateOrderStatus(orderId, next, currentStatus, cancelReason);
    if (result.success) { setCancelling(false); setReason(''); router.refresh(); }
    else setError(result.error || 'Не удалось изменить статус');
    setPending(false);
  }

  return <section className="od-card od-o4">
    <div className="od-card-head"><h2>Статус</h2><span className={chip.className}>{chip.label}</span></div>
    {currentStatus === 'cancelled' ? <p className="od-muted">Заказ отменён.</p>
      : <ol className="od-progress">{TRACKING_STEPS.map((step, position) => <li key={step}
        className={position < index ? 'done' : position === index ? 'current' : ''}><span />{ORDER_STAGE_LABELS[step]}</li>)}</ol>}
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

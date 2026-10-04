'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CourierOrder, CourierOrderStatus } from '@/lib/api-v1/staff-types';

const labels: Record<CourierOrderStatus, string> = {
  pending: 'Новый', confirmed: 'Собирается', delivering: 'В пути',
  delivered: 'Доставлен', cancelled: 'Отменён',
};
const transitions: Record<CourierOrderStatus, CourierOrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivering', 'cancelled'],
  delivering: ['delivered', 'cancelled'],
  delivered: [], cancelled: [],
};
const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Звонок' };

function OrderCard({ order }: { order: CourierOrder }) {
  const router = useRouter();
  const [status, setStatus] = useState(order.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState(Number(order.delivery_courier_amount || 0).toFixed(2));
  const [amountState, setAmountState] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function saveAmount() {
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { setError('Введите корректную сумму'); return; }
    setAmountState('saving'); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(order.order_id)}/delivery`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_courier_amount: value }),
      });
      if (!response.ok) throw new Error('Не удалось сохранить сумму. Повторите попытку.');
      setAmount(value.toFixed(2)); setAmountState('saved');
    } catch (cause) {
      setAmountState('idle');
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    }
  }

  async function changeStatus(next: CourierOrderStatus) {
    let reason: string | undefined;
    if (next === 'cancelled') {
      reason = window.prompt('Причина отмены заказа')?.trim();
      if (!reason) return;
    }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(order.order_id)}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, expected_current_status: status, ...(reason ? { reason } : {}) }),
      });
      if (!response.ok) {
        if (response.status === 409) { router.refresh(); throw new Error('Статус уже изменился. Обновите страницу.'); }
        throw new Error('Не удалось изменить статус. Повторите попытку.');
      }
      setStatus(next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    } finally { setBusy(false); }
  }

  return <article className="courier-order-card">
    <div className="courier-order-heading">
      <div><strong>Заказ {order.order_reference || order.order_id}</strong>
        <small>{new Date(order.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}</small></div>
      <div className="courier-order-pay"><strong>{Number(amount || 0).toLocaleString('ru-RU')} с.</strong>
        <small>заработок курьера</small><span className={`courier-order-status ${status}`}>{labels[status]}</span></div>
    </div>
    <div className="courier-order-details">
      <p><b>Аптека:</b> {order.pharmacy_id ? `Аптека ${order.pharmacy_id}` : 'Не указана'}</p>
      <p><b>Клиент:</b> {order.customer_name || 'Имя не указано'}</p>
      <p><b>Телефон:</b> <a href={`tel:${order.phone}`}>{order.phone}</a></p>
      <p><b>Адрес:</b> {order.address}</p>
      {order.landmark && <p><b>Ориентир:</b> {order.landmark}</p>}
      {order.notes && <p><b>Комментарий:</b> {order.notes}</p>}
      {order.order_source && <p><b>Источник:</b> {sourceLabels[order.order_source]}</p>}
    </div>
    {status !== 'cancelled' && <div className="courier-fee-editor">
      <label htmlFor={`fee-${order.order_id}`}><b>Получено за доставку:</b></label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input id={`fee-${order.order_id}`} type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
          value={amount} onChange={(event) => { setAmount(event.target.value); setAmountState('idle'); }}
          style={{ width: 120, minHeight: 44, padding: '6px 10px', font: 'inherit', borderRadius: 8, border: '1px solid #d0d5dd' }} />
        <span>с.</span>
        <button type="button" disabled={amountState === 'saving'} onClick={saveAmount}>
          {amountState === 'saving' ? '…' : amountState === 'saved' ? '✓ Сохранено' : 'Сохранить'}</button>
      </div>
    </div>}
    {transitions[status].length > 0 && <div className="courier-order-actions">
      {transitions[status].map((next) => <button key={next} type="button" disabled={busy}
        onClick={() => changeStatus(next)}>{next === 'cancelled' ? 'Отменить' : `→ ${labels[next]}`}</button>)}
    </div>}
    {error && <p className="courier-order-error" role="alert">{error}</p>}
  </article>;
}

export default function CourierOrderList({ orders }: { orders: CourierOrder[] }) {
  if (orders.length === 0) return <div className="staff-order-form">Заказов пока нет.</div>;
  return <div className="courier-order-list">{orders.map((order) => <OrderCard key={order.order_id} order={order} />)}</div>;
}

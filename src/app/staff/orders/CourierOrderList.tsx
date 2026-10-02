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
      <span className={`courier-order-status ${status}`}>{labels[status]}</span>
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

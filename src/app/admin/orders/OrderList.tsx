'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderStatus } from './actions';
import OrderDeleteButton from './OrderDeleteButton';
import type { AdminOrderSummary } from '@/lib/api-v1/admin-types';
import type { OrderStatus } from '@/lib/api-v1/types';

const labels: Record<OrderStatus, string> = {
  pending: 'Новый',
  confirmed: 'Подтверждён',
  delivering: 'В пути',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

const colors: Record<OrderStatus, string> = {
  pending: '#fbc02d',
  confirmed: '#29b6f6',
  delivering: '#0288d1',
  delivered: '#388e3c',
  cancelled: '#d32f2f',
};

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivering', 'cancelled'],
  delivering: ['delivered'],
  delivered: [],
  cancelled: [],
};

export default function OrderList({ initialOrders }: { initialOrders: AdminOrderSummary[] }) {
  const router = useRouter();
  const [orderRows, setOrderRows] = useState(initialOrders);
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const orders = filter === 'all'
    ? orderRows
    : orderRows.filter((order) => order.status === filter);

  const changeStatus = async (order: AdminOrderSummary, next: OrderStatus) => {
    let reason: string | undefined;
    if (next === 'cancelled') {
      reason = window.prompt('Укажите причину отмены')?.trim();
      if (!reason) return;
    }
    setLoadingId(order.order_id);
    setMessage(null);
    const result = await updateOrderStatus(order.order_id, next, order.status, reason);
    if (!result.success) {
      setMessage(result.error || 'Не удалось изменить статус');
    } else {
      setOrderRows((current) => current.map((item) => (
        item.order_id === order.order_id ? { ...item, status: next } : item
      )));
      router.refresh();
    }
    setLoadingId(null);
  };

  return (
    <div>
      {message && <div style={{ color: '#c62828', marginBottom: 16 }}>{message}</div>}
      <div style={{ display: 'flex', gap: 10, marginBottom: 30, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={{ padding: '8px 16px' }}>Все</button>
        {(Object.keys(labels) as OrderStatus[]).map((status) => (
          <button key={status} onClick={() => setFilter(status)} style={{ padding: '8px 16px' }}>
            {labels[status]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {orders.length === 0 && <div style={{ padding: 40, textAlign: 'center' }}>Заказов нет</div>}
        {orders.map((order) => (
          <article key={order.order_id} style={{ background: 'white', padding: 20, borderRadius: 12, border: '1px solid #E8E8E8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 8px' }}>Заказ {order.order_reference || order.order_id}</h3>
                <div>{new Date(order.created_at).toLocaleString('ru-RU')} · {order.customer_name}</div>
                <div style={{ color: '#666', marginTop: 4 }}>{order.phone} · {order.address}</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>
                  {Number(order.order_total || 0).toFixed(2)} {order.currency}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
                <span style={{ color: 'white', background: colors[order.status], padding: '5px 12px', borderRadius: 20 }}>
                  {labels[order.status]}
                </span>
                {transitions[order.status].length > 0 && (
                  <select
                    defaultValue=""
                    disabled={loadingId === order.order_id}
                    onChange={(event) => changeStatus(order, event.target.value as OrderStatus)}
                  >
                    <option value="" disabled>Изменить статус</option>
                    {transitions[order.status].map((status) => (
                      <option key={status} value={status}>{labels[status]}</option>
                    ))}
                  </select>
                )}
                <Link href={`/admin/orders/${encodeURIComponent(order.order_id)}`}>Открыть заказ</Link>
                {(order.status === 'pending' || order.status === 'cancelled') && (
                  <OrderDeleteButton
                    orderId={order.order_id}
                    orderReference={order.order_reference || order.order_id}
                    onDeleted={() => setOrderRows((current) => current.filter((item) => item.order_id !== order.order_id))}
                  />
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

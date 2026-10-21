'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatOrderDateTime } from '@/lib/order-time';
import { updateOrderStatus } from './actions';
import OrderDeleteButton from './OrderDeleteButton';
import type { AdminOrderSummary } from '@/lib/api-v1/admin-types';
import type { OrderStatus } from '@/lib/api-v1/types';
import { formatOrderSource } from '@/lib/collections';
import { stageChip, statusLabels as labels } from './ui';

const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivering', 'cancelled'],
  delivering: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Телефон' } as const;

export default function OrderList({ initialOrders }: { initialOrders: AdminOrderSummary[] }) {
  const router = useRouter();
  const [orderRows, setOrderRows] = useState(initialOrders);
  const [rowsFor, setRowsFor] = useState(initialOrders);
  // A live refresh brings new rows from the server: they replace the local (optimistic) copy.
  if (rowsFor !== initialOrders) { setRowsFor(initialOrders); setOrderRows(initialOrders); }
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const orders = orderRows;

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
        // The new stage comes with the refresh; until then the status fallback labels the chip.
        item.order_id === order.order_id ? { ...item, status: next, stage: undefined } : item
      )));
      router.refresh();
    }
    setLoadingId(null);
  };

  return (
    <div>
      {message && <p className="ao-alert" role="alert">{message}</p>}
      {orders.length === 0 ? <div className="ao-empty-card">Заказов не найдено</div> : <ul className="ao-work-list">
        {orders.map((order) => {
          const chip = stageChip(order);
          const from = order.created_by_staff_account_id === null ? { key: 'website', label: 'Сайт' }
            : order.created_by_staff_account_id === 3 ? { key: 'courier', label: 'Курьер' }
              : { key: 'pharmacy', label: `Аптека ${order.created_by_staff_account_id}` };
          return <li key={order.order_id} className={`ao-work-card ao-st-${order.status}`}>
            <Link href={`/admin/orders/${encodeURIComponent(order.order_id)}`} className="ao-work-main">
              <span className="ao-work-top">
                <strong>№ {order.order_reference || order.order_id.slice(-6)}</strong>
                <span className={chip.className}>{chip.label}</span>
              </span>
              <span className="ao-work-who">{order.customer_name || 'Имя не указано'} · {order.phone}</span>
              <span className="ao-work-where">{order.address}</span>
              <span className="ao-work-meta">
                <span className={`ao-origin ao-origin-${from.key}`}>{from.label}</span>
                {order.order_source && <span>{sourceLabels[order.order_source]}</span>}
                {formatOrderSource(order) && <span>{formatOrderSource(order)}</span>}
                <span>Аптека {order.fulfillment_pharmacy_id ?? 1}</span>
                <span>{formatOrderDateTime(order.created_at)}</span>
              </span>
            </Link>
            <div className="ao-work-side">
              <b>{Number(order.order_total || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с.</b>
              {transitions[order.status].length > 0 && <div className="ao-work-actions">
                {transitions[order.status].map((next) => <button key={next} type="button"
                  className={next === 'cancelled' ? 'ao-btn ao-btn-ghost' : 'ao-btn ao-btn-primary'}
                  disabled={loadingId === order.order_id} onClick={() => changeStatus(order, next)}>
                  {next === 'cancelled' ? 'Отменить' : `→ ${labels[next]}`}</button>)}
              </div>}
              {(order.status === 'pending' || order.status === 'cancelled' || order.status === 'delivered') && <OrderDeleteButton
                orderId={order.order_id} orderReference={order.order_reference || order.order_id}
                delivered={order.status === 'delivered'}
                onDeleted={() => setOrderRows((current) => current.filter((item) => item.order_id !== order.order_id))} />}
            </div>
          </li>;
        })}
      </ul>}
    </div>
  );
}

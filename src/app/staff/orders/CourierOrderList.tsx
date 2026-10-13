import Link from 'next/link';
import type { CourierOrder } from '@/lib/api-v1/staff-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { money } from '../format';
import { statusLabels } from './status';

export default function CourierOrderList({ orders }: { orders: CourierOrder[] }) {
  if (orders.length === 0) return <div className="c-empty"><strong>Заказов нет</strong><span>Новые заказы появятся здесь.</span></div>;
  return <ul className="c-list">{orders.map((order) => <li key={order.order_id}>
    <Link className={`c-row c-status-${order.status}`} href={`/staff/orders/${order.order_id}`}>
      <span className="c-row-top">
        <strong>№ {order.order_reference || order.order_id.slice(-6)}</strong>
        <span className={`c-pill c-pill-${order.status}`}>{statusLabels[order.status]}</span>
      </span>
      <span className="c-row-who">{order.customer_name || 'Без имени'} · {order.phone}</span>
      <span className="c-row-where">{order.address}</span>
      <span className="c-row-bottom">
        <small>{formatOrderDateTime(order.created_at)} · Аптека {order.pharmacy_id ?? 1} · {order.own_order ? 'ваш заказ' : 'с сайта'}</small>
        <strong>{money(order.order_total)}</strong>
      </span>
    </Link>
  </li>)}</ul>;
}

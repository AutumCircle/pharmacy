import Link from 'next/link';
import type { CourierOrder } from '@/lib/api-v1/staff-types';
import { checklistProgress } from '@/lib/courier-checklist';
import { formatOrderDateTime } from '@/lib/order-time';
import { splitLegacyAddress } from '@/lib/checkout-order';
import { answersProgressText } from '@/lib/pharmacy-answers';
import { courierAssemblySummary } from '@/lib/pharmacy-assembly';
import { money } from '../format';
import { stagePill } from './status';

export default function CourierOrderList({ orders, emptyText = 'Новые заказы появятся здесь.' }: {
  orders: CourierOrder[]; emptyText?: string;
}) {
  if (orders.length === 0) return <div className="c-empty"><strong>Заказов нет</strong><span>{emptyText}</span></div>;
  return <ul className="c-list">{orders.map((order) => {
    const progress = checklistProgress(order);
    const answers = order.website_order && order.status === 'pending' ? answersProgressText(order) : null;
    // Rework 1: assembly happens while «Новый», so the marks line shows for pending and confirmed orders.
    const assembly = order.status === 'pending' || order.status === 'confirmed' ? courierAssemblySummary(order) : null;
    const assembled = assembly !== null && order.assembly_complete === true;
    const pill = stagePill(order);
    return <li key={order.order_id}>
      <Link className={`c-row c-status-${order.status}`} href={`/staff/orders/${order.order_id}`}>
        <span className="c-row-top">
          <strong>№ {order.order_reference || order.order_id.slice(-6)}</strong>
          <span className={pill.className}>{pill.label}</span>
        </span>
        <span className="c-row-who">{order.customer_name || 'Без имени'} · {order.phone}</span>
        <span className="c-row-where">{splitLegacyAddress(order.address, order.landmark).address}</span>
        {progress && <span className={`c-row-checklist${progress.next ? '' : ' done'}`}>
          <b>{progress.done} из {progress.total} шагов</b>{progress.next ? ` · ${progress.next.title}` : ' · всё готово'}</span>}
        {answers && <span className={`c-row-answers${order.pharmacy_answers_complete ? ' done' : ''}`}>{answers}</span>}
        {assembly && <span className={`c-row-answers${assembled ? ' done' : ''}`}>Сборка: {assembly}</span>}
        <span className="c-row-bottom">
          <small>{formatOrderDateTime(order.created_at)} · Аптека {order.pharmacy_id ?? 1} · {order.own_order ? 'ваш заказ' : 'с сайта'}</small>
          <strong>{money(order.order_total)}</strong>
        </span>
      </Link>
    </li>;
  })}</ul>;
}

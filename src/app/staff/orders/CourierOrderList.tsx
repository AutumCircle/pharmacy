import Link from 'next/link';
import type { CourierOrder } from '@/lib/api-v1/staff-types';
import { checklistProgress } from '@/lib/courier-checklist';
import { formatOrderDateTime } from '@/lib/order-time';
import { answersProgressText } from '@/lib/pharmacy-answers';
import { assemblyWarning, courierAssemblySummary } from '@/lib/pharmacy-assembly';
import { money } from '../format';
import { statusLabels } from './status';

export default function CourierOrderList({ orders }: { orders: CourierOrder[] }) {
  if (orders.length === 0) return <div className="c-empty"><strong>Заказов нет</strong><span>Новые заказы появятся здесь.</span></div>;
  return <ul className="c-list">{orders.map((order) => {
    const progress = checklistProgress(order);
    const answers = order.website_order && order.status === 'pending' ? answersProgressText(order) : null;
    const assembly = order.status === 'confirmed' ? courierAssemblySummary(order) : null;
    const assembled = assembly !== null && assemblyWarning(order) === null;
    return <li key={order.order_id}>
      <Link className={`c-row c-status-${order.status}`} href={`/staff/orders/${order.order_id}`}>
        <span className="c-row-top">
          <strong>№ {order.order_reference || order.order_id.slice(-6)}</strong>
          <span className={`c-pill c-pill-${order.status}`}>{statusLabels[order.status]}</span>
        </span>
        <span className="c-row-who">{order.customer_name || 'Без имени'} · {order.phone}</span>
        <span className="c-row-where">{order.address}</span>
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

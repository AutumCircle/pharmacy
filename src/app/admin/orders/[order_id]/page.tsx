import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminOrder } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import { formatOrderDateTime } from '@/lib/order-time';
import { formatOrderSource } from '@/lib/collections';
import OrderStatusControl from './OrderStatusControl';
import OrderDeliveryEditor from './OrderDeliveryEditor';
import OrderCustomerEditor from './OrderCustomerEditor';
import OrderItems from './OrderItems';
import OrderAddItems from './OrderAddItems';
import OrderDeleteButton from '../OrderDeleteButton';
import { money, origin, statusLabels } from '../ui';
import '../orders-ui.css';

const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Звонок' } as const;
const actorLabels: Record<string, string> = { customer: 'клиент', admin: 'админ', staff: 'сотрудник', system: 'система' };

export const dynamic = 'force-dynamic';

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ order_id: string }> }) {
  await requireAdminSession();
  const { order_id: encodedOrderId } = await params;
  const orderId = decodeURIComponent(encodedOrderId);
  let order;
  try {
    order = (await getAdminOrder(orderId)).data;
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  }
  const from = origin(order.created_by_staff_account_id);
  const itemsTotal = Number(order.order_total || 0);
  const baseTotal = order.items.reduce((sum, item) => sum + Number(item.base_unit_price || 0) * Number(item.quantity), 0);
  const delivery = Number(order.delivery_courier_amount || 0) + Number(order.delivery_owner_amount || 0);
  const transition = formatOrderSource(order);

  return <div className="od">
    <Link href="/admin/orders" className="od-back">← Все заказы</Link>
    <header className="od-header">
      <div>
        <div className="od-title"><h1>№ {order.order_reference || order.order_id}</h1>
          <span className={`ao-status ao-status-${order.status}`}>{statusLabels[order.status]}</span></div>
        <p className="od-meta">
          <span className={`ao-origin ao-origin-${from.key}`}>{from.label}</span>
          {order.created_by_staff_account_id === 3 && order.created_by_staff_username && <span>{order.created_by_staff_username}</span>}
          {order.order_source && <span>{sourceLabels[order.order_source]}</span>}
          {transition && <span>{transition}</span>}
          <span>Аптека {order.fulfillment_pharmacy_id ?? 1}</span>
          <span>Создан {formatOrderDateTime(order.created_at)}</span>
        </p>
      </div>
      <dl className="od-totals">
        <div><dt>Клиент платит</dt><dd>{money(itemsTotal, 2)}</dd></div>
        <div><dt>Цена аптеки</dt><dd>{money(baseTotal, 2)}</dd></div>
        <div><dt>Прибыль</dt><dd className={itemsTotal - baseTotal >= 0 ? 'od-profit' : 'od-loss'}>{money(itemsTotal - baseTotal, 2)}</dd></div>
        <div><dt>Доставка</dt><dd>{money(delivery, 2)}</dd></div>
      </dl>
    </header>

    <div className="od-layout">
      <div className="od-main">
        <section className="od-card od-o3">
          <div className="od-card-head"><h2>Товары</h2><b>{money(itemsTotal, 2)}</b></div>
          <p className="od-muted od-small">Нажмите на товар, чтобы изменить количество, цену аптеки, цену клиенту или удалить его.</p>
          <OrderItems orderId={order.order_id} items={order.items} status={order.status} />
          <OrderAddItems orderId={order.order_id} status={order.status} websiteOrder={order.created_by_staff_account_id === null} />
        </section>
        <section className="od-card od-o5">
          <div className="od-card-head"><h2>История</h2></div>
          <ol className="od-history">
            {order.status_history.map((entry, index) => <li key={`${entry.created_at}-${index}`}>
              <span className="od-dot" />
              <div><strong>{entry.from_status ? `${statusLabels[entry.from_status]} → ` : 'Создан · '}{statusLabels[entry.to_status]}</strong>
                <small>{formatOrderDateTime(entry.created_at)} · {actorLabels[entry.actor_type] ?? entry.actor_type}
                  {entry.actor_id ? ` ${entry.actor_id}` : ''}</small>
                {entry.reason && <p>{entry.reason}</p>}</div>
            </li>)}
          </ol>
        </section>
      </div>
      <aside className="od-side">
        <OrderStatusControl key={order.status} orderId={order.order_id} currentStatus={order.status} />
        <OrderCustomerEditor key={`${order.edit_revision}`} orderId={order.order_id} revision={order.edit_revision}
          customerName={order.customer_name || ''} phone={order.phone || ''} address={order.address || ''}
          landmark={order.landmark} comment={order.notes} />
        <OrderDeliveryEditor key={`${order.delivery_courier_amount}-${order.delivery_owner_amount}`} orderId={order.order_id}
          courierAmount={Number(order.delivery_courier_amount || 0)} ownerAmount={Number(order.delivery_owner_amount || 0)} />
        {(order.status === 'pending' || order.status === 'cancelled') && <section className="od-card od-danger od-o6">
          <div className="od-card-head"><h2>Удаление</h2></div>
          <p className="od-muted od-small">Заказ исчезнет из рабочих списков. Доступно только для новых и отменённых заказов.</p>
          <OrderDeleteButton orderId={order.order_id} orderReference={order.order_reference || order.order_id} redirectTo="/admin/orders" />
        </section>}
      </aside>
    </div>
  </div>;
}

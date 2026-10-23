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
import OrderItems, { type OrderItemMeta } from './OrderItems';
import OrderAddItems from './OrderAddItems';
import OrderFulfillment from './OrderFulfillment';
import OrderTimeline from './OrderTimeline';
import OrderDeleteButton from '../OrderDeleteButton';
import LiveRefresh from '@/components/LiveRefresh';
import { money, origin, stageChip } from '../ui';
import type { AdminOrderDetail } from '@/lib/api-v1/admin-types';
import { allItemsUnavailable, courierItemAnswerLabel, courierItemAnswerTone } from '@/lib/pharmacy-answers';
import { itemChangeText, itemPharmacyText, latestItemChanges, timelineEvents } from '@/lib/order-timeline';
import '../orders-ui.css';

const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Звонок' } as const;

/** Job 016: per-item pharmacy, answer chip and latest change for the items table. */
function itemMeta(order: AdminOrderDetail): Record<number, OrderItemMeta> {
  const fulfillmentItems = new Map((Array.isArray(order.fulfillment?.items) ? order.fulfillment.items : [])
    .map((item) => [item.order_item_id, item]));
  const latest = latestItemChanges(timelineEvents(order.timeline));
  const orderPharmacy = order.fulfillment_pharmacy_id
    ?? (order.created_by_staff_account_id === 2 ? 2 : 1);
  return Object.fromEntries(order.items.map((item) => {
    const answered = fulfillmentItems.get(item.order_item_id);
    const pharmacy = itemPharmacyText(answered?.pharmacy_id ?? orderPharmacy, answered?.answers);
    const label = answered ? courierItemAnswerLabel({ pharmacy_id: answered.pharmacy_id, answers: answered.answers }) : null;
    const tone = answered ? courierItemAnswerTone({ pharmacy_id: answered.pharmacy_id, answers: answered.answers }) ?? 'wait' : 'wait';
    const change = latest.get(item.order_item_id);
    return [item.order_item_id, {
      pharmacy: pharmacy.name, pharmacyNote: pharmacy.note,
      answer: label ? { text: label, tone } : null,
      change: change ? { text: itemChangeText(change), at: change.at, time: formatOrderDateTime(change.at) } : null,
    } satisfies OrderItemMeta];
  }));
}

function confirmedText(order: AdminOrderDetail): string {
  const fulfillment = order.fulfillment;
  if (!fulfillment || fulfillment.confirmed_total === null || fulfillment.confirmed_total === undefined
    || fulfillment.confirmed_total === '') return 'ждёт ответа';
  if (allItemsUnavailable(fulfillment)) return 'всё нет в наличии';
  return money(fulfillment.confirmed_total, 2);
}

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
  const chip = stageChip(order);

  return <div className="od">
    <LiveRefresh />
    <Link href="/admin/orders" className="od-back">← Все заказы</Link>
    <header className="od-header">
      <div>
        <div className="od-title"><h1>№ {order.order_reference || order.order_id}</h1>
          <span className={chip.className}>{chip.label}</span></div>
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
        <section className="od-card od-o3" aria-labelledby="od-items-title">
          <div className="od-card-head"><h2 id="od-items-title">Товары</h2><b>{money(itemsTotal, 2)}</b></div>
          <p className="od-muted od-small">Нажмите на товар, чтобы изменить количество, цену аптеки, цену клиенту или удалить его.</p>
          <OrderItems orderId={order.order_id} items={order.items} status={order.status} meta={itemMeta(order)} />
          <dl className="od-sums">
            <div><dt>Сумма заказа</dt><dd>{money(itemsTotal, 2)}</dd></div>
            {order.fulfillment && <div className={order.fulfillment.confirmed_total == null ? 'od-sum-wait' : 'od-sum-ok'}>
              <dt>Подтверждено аптеками</dt><dd>{confirmedText(order)}</dd></div>}
          </dl>
          <OrderAddItems orderId={order.order_id} status={order.status} websiteOrder={order.created_by_staff_account_id === null} />
        </section>
        <section className="od-card od-o5" aria-labelledby="od-history-title">
          <div className="od-card-head"><h2 id="od-history-title">История</h2></div>
          <OrderTimeline timeline={order.timeline} truncated={order.timeline_truncated === true}
            statusHistory={order.status_history} />
        </section>
      </div>
      <aside className="od-side">
        <OrderCustomerEditor key={`${order.edit_revision}`} orderId={order.order_id} revision={order.edit_revision}
          customerName={order.customer_name || ''} phone={order.phone || ''} address={order.address || ''}
          landmark={order.landmark} comment={order.notes}
          paymentMethod={order.created_by_staff_account_id === null ? order.payment_method : null} />
        {order.fulfillment && <OrderFulfillment fulfillment={order.fulfillment} status={order.status} />}
        <OrderStatusControl key={`${order.status}-${order.stage ?? ''}`} orderId={order.order_id}
          currentStatus={order.status} stage={order.stage} />
        <OrderDeliveryEditor key={`${order.delivery_courier_amount}-${order.delivery_owner_amount}`} orderId={order.order_id}
          courierAmount={Number(order.delivery_courier_amount || 0)} ownerAmount={Number(order.delivery_owner_amount || 0)} />
        {(order.status === 'pending' || order.status === 'cancelled' || order.status === 'delivered') && <section className="od-card od-danger od-o7">
          <div className="od-card-head"><h2>Удаление</h2></div>
          <p className="od-muted od-small">Заказ исчезнет из списков и отчётов. История и состав сохранятся.</p>
          <OrderDeleteButton orderId={order.order_id} orderReference={order.order_reference || order.order_id}
            delivered={order.status === 'delivered'} redirectTo="/admin/orders" />
        </section>}
      </aside>
    </div>
  </div>;
}

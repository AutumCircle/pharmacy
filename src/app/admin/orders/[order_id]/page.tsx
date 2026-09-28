import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminOrder } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import OrderStatusControl from './OrderStatusControl';
import OrderItemPriceEditor from './OrderItemPriceEditor';
import OrderDeleteButton from '../OrderDeleteButton';

const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Телефонный звонок' } as const;

export const dynamic = 'force-dynamic';

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ order_id: string }>;
}) {
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

  return (
    <div>
      <Link href="/admin/orders">← Назад к заказам</Link>
      <h1 style={{ margin: '24px 0' }}>Заказ {order.order_reference || order.order_id}</h1>
      <section style={{ background: 'white', padding: 20, borderRadius: 12, marginBottom: 20 }}>
        {order.created_by_staff_account_id && <p><strong>Принял заказ:</strong> Аптека {order.created_by_staff_account_id} · {order.created_by_staff_username}</p>}
        {order.order_source && <p><strong>Источник:</strong> {sourceLabels[order.order_source]}</p>}
        <p><strong>Клиент:</strong> {order.customer_name || 'Не указан'}</p>
        <p><strong>Телефон:</strong> {order.phone}</p>
        <p><strong>Адрес:</strong> {order.address}</p>
        {order.landmark && <p><strong>Ориентир:</strong> {order.landmark}</p>}
        <p><strong>Комментарий:</strong> {order.notes || 'Не указан'}</p>
        <p><strong>Создан:</strong> {new Date(order.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}</p>
        <p><strong>Статус:</strong></p>
        <OrderStatusControl orderId={order.order_id} currentStatus={order.status} />
        {(order.status === 'pending' || order.status === 'cancelled') && (
          <div style={{ marginTop: 18 }}>
            <OrderDeleteButton
              orderId={order.order_id}
              orderReference={order.order_reference || order.order_id}
              redirectTo="/admin/orders"
            />
          </div>
        )}
        <p><strong>Итого:</strong> {Number(order.order_total || 0).toFixed(2)} {order.currency}</p>
        <p style={{ color: '#666' }}>Стоимость доставки в сумму заказа не включена.</p>
      </section>

      <h2>Состав заказа</h2>
      {order.items.length === 0 && <p style={{ background: '#fff8e6', padding: 14, borderRadius: 8 }}>Товары уточняются по телефону.</p>}
      <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12 }}>
        <table className="admin-table">
          <thead><tr><th>medicine_id</th><th>Товар</th><th>Количество</th><th>Базовая цена</th><th>Цена продажи</th><th>Сумма</th></tr></thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={`${item.medicine_id ?? 'legacy'}-${index}`}>
                <td>{item.medicine_id ?? 'legacy'}</td>
                <td>{item.medicine_name}</td>
                <td>{item.quantity}</td>
                <td>{Number(item.base_unit_price || 0).toFixed(2)}</td>
                <td><OrderItemPriceEditor orderId={order.order_id} orderItemId={item.order_item_id} initialPrice={Number(item.selling_unit_price || 0)} /></td>
                <td>{Number(item.line_total || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 30 }}>История статусов</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {order.status_history.map((entry, index) => (
          <div key={`${entry.created_at}-${index}`} style={{ background: 'white', padding: 14, borderRadius: 8 }}>
            {entry.from_status || 'создан'} → {entry.to_status} · {new Date(entry.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}
            {entry.actor_id ? ` · ${entry.actor_type}: ${entry.actor_id}` : ''}
            {entry.reason ? ` · ${entry.reason}` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

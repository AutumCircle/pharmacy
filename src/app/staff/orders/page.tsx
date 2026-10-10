import Link from 'next/link';
import { requireStaffSession } from '@/lib/staff-auth';
import { getCourierEarnings, listCourierOrders, listPharmacyPreparationOrders } from '@/lib/api-v1/staff-server';
import type { CourierOrderStatus } from '@/lib/api-v1/staff-types';
import CourierOrderList from './CourierOrderList';

export const dynamic = 'force-dynamic';

const filters: Array<{ value: CourierOrderStatus | ''; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Новые' },
  { value: 'confirmed', label: 'Собираются' },
  { value: 'delivering', label: 'В пути' },
  { value: 'delivered', label: 'Доставлены' },
];

export default async function CourierOrdersPage({ searchParams }: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { account, token } = await requireStaffSession();
  const params = await searchParams;
  if (account.role === 'pharmacy') {
    const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
    const response = await listPharmacyPreparationOrders(token, { cursor, limit: 20 });
    return <section className="courier-orders-page">
      <div className="staff-title-row"><div><h1>Заказы на сборку</h1>
        <p>Аптека {account.account_id} · заказы с сайта, ожидающие подготовки</p></div>
        <Link className="courier-new-order" href="/staff/orders">Обновить</Link>
      </div>
      {response.data.length === 0 ? <div className="staff-order-form">Сейчас заказов на сборку нет.</div>
        : <div className="courier-order-list">{response.data.map((order) => <article className="courier-order-card" key={order.order_id}>
          <div className="courier-order-heading"><div><strong>Заказ {order.order_reference || order.order_id}</strong>
            <small>{new Date(order.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}</small></div>
            <span className={`courier-order-status ${order.status}`}>{order.status === 'pending' ? 'Новый' : 'Собирается'}</span></div>
          {order.customer_name && <p>Клиент: {order.customer_name}</p>}
          <ul className="pharmacy-preparation-items">{order.medicines.map((item, index) =>
            <li key={`${item.medicine_name}-${index}`}>{item.medicine_name} × {item.quantity}</li>)}</ul>
          {order.notes && <p>Комментарий: {order.notes}</p>}
        </article>)}</div>}
      {response.page.next_cursor && <div className="staff-pagination"><Link href={`/staff/orders?cursor=${encodeURIComponent(response.page.next_cursor)}`}>Следующие заказы →</Link></div>}
    </section>;
  }
  const status = filters.find((filter) => filter.value && filter.value === params.status)?.value || '';
  const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
  const [response, earningsResponse] = await Promise.all([
    listCourierOrders(token, { status: status || undefined, cursor, limit: 20 }),
    getCourierEarnings(token, { limit: 7 }).catch(() => null),
  ]);
  const next = response.page.next_cursor;
  const nextHref = next ? `/staff/orders?${new URLSearchParams({
    ...(status ? { status } : {}), cursor: next,
  })}` : null;

  return <section className="courier-orders-page">
    <div className="staff-title-row">
      <div><h1>Заказы</h1><p>Все заказы для доставки</p></div>
      <Link className="courier-new-order" href="/staff/orders/new">+ Новый заказ</Link>
    </div>
    <section className="courier-earnings-summary">
      <article><span>Заработано всего</span><strong>{Number(earningsResponse?.data.total ?? 0).toLocaleString('ru-RU')} с.</strong></article>
      <article><span>Сегодня</span><strong>{Number(earningsResponse?.data.today ?? 0).toLocaleString('ru-RU')} с.</strong></article>
      <article><span>Вчера</span><strong>{Number(earningsResponse?.data.yesterday ?? 0).toLocaleString('ru-RU')} с.</strong></article>
      <Link href="/staff/earnings">Вся история по дням →</Link>
    </section>
    <nav className="staff-filters" aria-label="Фильтр заказов">
      {filters.map((filter) => <Link key={filter.value} className={status === filter.value ? 'active' : ''}
        href={filter.value ? `/staff/orders?status=${filter.value}` : '/staff/orders'}>{filter.label}</Link>)}
    </nav>
    <CourierOrderList orders={response.data} />
    {nextHref && <div className="staff-pagination"><Link href={nextHref}>Следующие заказы →</Link></div>}
  </section>;
}

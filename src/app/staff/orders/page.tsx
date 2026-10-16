import Link from 'next/link';
import { requireStaffSession } from '@/lib/staff-auth';
import { listCourierOrders, listPharmacyPreparationOrders } from '@/lib/api-v1/staff-server';
import type { CourierOrderStatus } from '@/lib/api-v1/staff-types';
import CourierOrderList from './CourierOrderList';
import PharmacyOrderCard from './PharmacyOrderCard';

export const dynamic = 'force-dynamic';

const filters: Array<{ value: CourierOrderStatus | ''; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Новые' },
  { value: 'confirmed', label: 'Собираются' },
  { value: 'delivering', label: 'В пути' },
  { value: 'delivered', label: 'Доставлены' },
];

// Request time for the first paint of the waiting badge (same pattern as admin/orders).
function requestTime() {
  return new Date().getTime();
}

export default async function CourierOrdersPage({ searchParams }: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { account, token } = await requireStaffSession();
  const params = await searchParams;
  if (account.role === 'pharmacy') {
    const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
    const response = await listPharmacyPreparationOrders(token, { cursor, limit: 20 });
    const now = requestTime();
    return <section className="courier-orders-page">
      <div className="staff-title-row"><div><h1>Заказы на сборку</h1>
        <p>Аптека {account.account_id} · заказы с сайта, ожидающие подготовки</p></div>
        <Link className="courier-new-order" href="/staff/orders">Обновить</Link>
      </div>
      {response.data.length === 0 ? <div className="staff-order-form">Сейчас заказов на сборку нет.</div>
        : <div className="courier-order-list">{response.data.map((order) =>
          <PharmacyOrderCard key={order.order_id} order={order} now={now} />)}</div>}
      {response.page.next_cursor && <div className="staff-pagination"><Link href={`/staff/orders?cursor=${encodeURIComponent(response.page.next_cursor)}`}>Следующие заказы →</Link></div>}
    </section>;
  }
  const status = filters.find((filter) => filter.value && filter.value === params.status)?.value || '';
  const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
  const response = await listCourierOrders(token, { status: status || undefined, cursor, limit: 20 });
  const next = response.page.next_cursor;
  const nextHref = next ? `/staff/orders?${new URLSearchParams({
    ...(status ? { status } : {}), cursor: next,
  })}` : null;

  return <section className="c-page">
    <div className="c-page-head"><h1>Заказы</h1></div>
    <nav className="c-tabs" aria-label="Фильтр заказов">
      {filters.map((filter) => <Link key={filter.value} className={status === filter.value ? 'active' : ''}
        aria-current={status === filter.value ? 'page' : undefined}
        href={filter.value ? `/staff/orders?status=${filter.value}` : '/staff/orders'}>{filter.label}</Link>)}
    </nav>
    <CourierOrderList orders={response.data} />
    {nextHref && <Link className="c-btn c-btn-outline c-btn-wide c-more" href={nextHref}>Показать ещё</Link>}
  </section>;
}

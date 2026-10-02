import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';
import { listCourierOrders } from '@/lib/api-v1/staff-server';
import type { CourierOrderStatus } from '@/lib/api-v1/staff-types';
import CourierOrderList from './CourierOrderList';

export const dynamic = 'force-dynamic';

const filters: Array<{ value: CourierOrderStatus | ''; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Новые' },
  { value: 'confirmed', label: 'Собираются' },
  { value: 'delivering', label: 'В пути' },
];

export default async function CourierOrdersPage({ searchParams }: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { account, token } = await requireStaffSession();
  if (account.role !== 'courier') redirect('/staff/orders/new');
  const params = await searchParams;
  const status = filters.find((filter) => filter.value && filter.value === params.status)?.value || '';
  const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
  const response = await listCourierOrders(token, { status: status || undefined, cursor, limit: 20 });
  const next = response.page.next_cursor;
  const nextHref = next ? `/staff/orders?${new URLSearchParams({
    ...(status ? { status } : {}), cursor: next,
  })}` : null;

  return <section className="courier-orders-page">
    <div className="staff-title-row">
      <div><h1>Заказы</h1><p>Все заказы для доставки</p></div>
      <Link className="courier-new-order" href="/staff/orders/new">+ Новый заказ</Link>
    </div>
    <nav className="staff-filters" aria-label="Фильтр заказов">
      {filters.map((filter) => <Link key={filter.value} className={status === filter.value ? 'active' : ''}
        href={filter.value ? `/staff/orders?status=${filter.value}` : '/staff/orders'}>{filter.label}</Link>)}
    </nav>
    <CourierOrderList orders={response.data} />
    {nextHref && <div className="staff-pagination"><Link href={nextHref}>Следующие заказы →</Link></div>}
  </section>;
}

import Link from 'next/link';
import { getAdminDashboardSummary, listAdminOrders, listDeliveredAdminOrdersByDay } from '@/lib/api-v1/admin-server';
import { requireAdminSession } from '@/lib/admin-auth';
import type { OrderStatus } from '@/lib/api-v1/types';
import OrderList from './OrderList';
import OrderEarningsPanel from './OrderEarningsPanel';
import DeliveredDayPanel from './DeliveredDayPanel';

export const dynamic = 'force-dynamic';

function dushanbeToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dushanbe', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function OrdersViews({ selected }: { selected: 'day' | 'work' | 'finance' }) {
  return <nav className="admin-orders-views" aria-label="Разделы заказов">
    <Link className={selected === 'day' ? 'active' : ''} href="/admin/orders?view=day">По дням доставки</Link>
    <Link className={selected === 'work' ? 'active' : ''} href="/admin/orders?view=work">Рабочие заказы</Link>
    <Link className={selected === 'finance' ? 'active' : ''} href="/admin/orders?view=finance">Финансы</Link>
  </nav>;
}

type OrderFilter = OrderStatus | 'active';
const statusFilters: Array<{ value: OrderFilter | ''; label: string }> = [
  { value: '', label: 'Все' }, { value: 'active', label: 'Не доставлены' },
  { value: 'pending', label: 'Новые' }, { value: 'confirmed', label: 'Собираются' },
  { value: 'delivering', label: 'В пути' }, { value: 'delivered', label: 'Доставлены' },
  { value: 'cancelled', label: 'Отменены' },
];

export default async function AdminOrdersPage({ searchParams }: {
  searchParams: Promise<{ view?: string; date?: string; q?: string; status?: string; created_from?: string; created_to?: string; cursor?: string; days?: string }>;
}) {
  await requireAdminSession();
  const params = await searchParams;
  const view = params.view === 'work' || params.view === 'finance' ? params.view : 'day';
  if (view === 'day') {
    const today = dushanbeToday();
    const requested = params.date || today;
    const selected = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(`${requested}T12:00:00Z`))
      ? requested : today;
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const report = await listDeliveredAdminOrdersByDay(selected, params.cursor);
    return <div><h1>Заказы по дням доставки</h1><OrdersViews selected="day" />
      <DeliveredDayPanel report={report} today={today} yesterday={yesterday.toISOString().slice(0, 10)} /></div>;
  }
  const days = ([7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30) as 7 | 30 | 90;
  if (view === 'finance') {
    const summary = await getAdminDashboardSummary(days);
    return <div><h1>Финансы заказов</h1><OrdersViews selected="finance" />
      <OrderEarningsPanel summary={summary.data} days={days} /></div>;
  }
  const status = params.status === 'all' ? undefined
    : statusFilters.some((filter) => filter.value === params.status) ? params.status as OrderFilter : 'active';
  const q = (params.q || '').trim();
  const createdFrom = params.created_from || '';
  const createdTo = params.created_to || '';
  const response = await listAdminOrders({
    q,
    status,
    createdFrom: createdFrom ? `${createdFrom}T00:00:00Z` : undefined,
    createdTo: createdTo ? `${createdTo}T23:59:59Z` : undefined,
    cursor: params.cursor,
    limit: 50,
  });

  const nextParams = new URLSearchParams({ view: 'work' });
  if (q) nextParams.set('q', q);
  nextParams.set('status', status || 'all');
  if (createdFrom) nextParams.set('created_from', createdFrom);
  if (createdTo) nextParams.set('created_to', createdTo);
  if (response.page.next_cursor) nextParams.set('cursor', response.page.next_cursor);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>Рабочие заказы</h1>
      <OrdersViews selected="work" />
      <p style={{ color: '#666', marginTop: 0 }}>Поиск и фильтрация выполняются в базе. Суммы показаны без доставки.</p>

      <h2 className="admin-orders-list-title">Рабочие заказы</h2>

      <nav className="admin-order-status-filters" aria-label="Статус заказов">
        {statusFilters.map((filter) => {
          const linkParams = new URLSearchParams({ view: 'work' });
          linkParams.set('status', filter.value || 'all');
          if (q) linkParams.set('q', q);
          if (createdFrom) linkParams.set('created_from', createdFrom);
          if (createdTo) linkParams.set('created_to', createdTo);
          return <Link key={filter.value} className={(status || '') === filter.value ? 'active' : ''}
            href={`/admin/orders?${linkParams}`}>{filter.label}</Link>;
        })}
      </nav>

      <form method="get" className="admin-search-section" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 10 }}>
        <input type="hidden" name="view" value="work" />
        <input className="admin-search-input" name="q" defaultValue={q} placeholder="Номер заказа, телефон или имя" />
        <select name="status" defaultValue={status || 'all'}>
          <option value="all">Все статусы</option>
          <option value="active">Не доставлены</option>
          <option value="pending">Новый</option>
          <option value="confirmed">Подтверждён</option>
          <option value="delivering">Доставляется</option>
          <option value="delivered">Доставлен</option>
          <option value="cancelled">Отменён</option>
        </select>
        <input type="date" name="created_from" defaultValue={createdFrom} aria-label="Дата от" />
        <input type="date" name="created_to" defaultValue={createdTo} aria-label="Дата до" />
        <button type="submit" style={{ padding: '10px 18px', cursor: 'pointer' }}>Найти</button>
      </form>

      <OrderList key={`${status}-${q}-${createdFrom}-${createdTo}-${params.cursor || ''}`} initialOrders={response.data} />
      {response.page.has_more && response.page.next_cursor && (
        <div className="admin-pagination">
          <Link href={`/admin/orders?${nextParams.toString()}`}>Следующая страница</Link>
        </div>
      )}
    </div>
  );
}

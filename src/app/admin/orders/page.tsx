import Link from 'next/link';
import { getAdminOrdersInsights, listAdminOrders, listDeliveredAdminOrdersByDay } from '@/lib/api-v1/admin-server';
import type { OrdersInsightsPeriod } from '@/lib/api-v1/admin-types';
import { requireAdminSession } from '@/lib/admin-auth';
import type { OrderStatus } from '@/lib/api-v1/types';
import OrderList from './OrderList';
import LiveNow from './LiveNow';
import FinanceView from './FinanceView';
import { ClientsCard, DailyChart, DayPanel, KpiGrid, PeakHours, TopMedicines } from './OverviewSections';
import './orders-ui.css';

export const dynamic = 'force-dynamic';

type View = 'overview' | 'work' | 'finance';
type OrderFilter = OrderStatus | 'active';

const statusFilters: Array<{ value: OrderFilter | 'all'; label: string }> = [
  { value: 'active', label: 'В работе' }, { value: 'pending', label: 'Новые' },
  { value: 'confirmed', label: 'Собираются' }, { value: 'delivering', label: 'В пути' },
  { value: 'delivered', label: 'Доставлены' }, { value: 'cancelled', label: 'Отменены' }, { value: 'all', label: 'Все' },
];
const periods: Array<{ value: OrdersInsightsPeriod; label: string }> = [
  { value: 1, label: 'Сегодня' }, { value: 7, label: '7 дней' }, { value: 30, label: '30 дней' }, { value: 90, label: '90 дней' },
];

function dushanbeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

function requestTime() {
  return new Date().getTime();
}

function shiftDay(date: string, delta: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function href(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
  return `/admin/orders?${query}`;
}

function Header({ view, days }: { view: View; days: OrdersInsightsPeriod }) {
  return <header className="ao-header">
    <div className="ao-title"><h1>Заказы</h1>
      <nav className="ao-tabs" aria-label="Разделы заказов">
        {([['overview', 'Обзор'], ['work', 'Рабочие заказы'], ['finance', 'Финансы']] as const).map(([value, label]) =>
          <Link key={value} href={href({ view: value, days: value === 'work' ? undefined : days })}
            className={view === value ? 'active' : ''} aria-current={view === value ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </div>
    {view !== 'work' && <nav className="ao-periods" aria-label="Период">
      {periods.map((period) => <Link key={period.value} href={href({ view, days: period.value })}
        className={days === period.value ? 'active' : ''} aria-current={days === period.value ? 'true' : undefined}>{period.label}</Link>)}
    </nav>}
  </header>;
}

export default async function AdminOrdersPage({ searchParams }: {
  searchParams: Promise<{ view?: string; date?: string; q?: string; status?: string; created_from?: string; created_to?: string; cursor?: string; days?: string }>;
}) {
  await requireAdminSession();
  const params = await searchParams;
  const view: View = params.view === 'work' || params.view === 'finance' ? params.view : 'overview';
  const days = ([1, 7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 7) as OrdersInsightsPeriod;

  if (view === 'overview') {
    const today = dushanbeToday();
    const requested = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') && !Number.isNaN(Date.parse(`${params.date}T12:00:00Z`))
      ? params.date! : today;
    const selected = requested > today ? today : requested;
    const [insights, report] = await Promise.all([
      getAdminOrdersInsights(days), listDeliveredAdminOrdersByDay(selected, params.cursor),
    ]);
    const dayHref = (date: string) => `${href({ view: 'overview', days, date })}#day`;
    return <div className="ao">
      <Header view={view} days={days} />
      <LiveNow live={insights.data.live} renderedAt={requestTime()} />
      <KpiGrid insights={insights.data} />
      <DailyChart insights={insights.data} selected={selected} hrefFor={dayHref} />
      <DayPanel report={report} isToday={selected === today} prevHref={dayHref(shiftDay(selected, -1))}
        nextHref={selected < today ? dayHref(shiftDay(selected, 1)) : null} />
      {report.page.has_more && report.page.next_cursor && <Link className="ao-more"
        href={`${href({ view: 'overview', days, date: selected, cursor: report.page.next_cursor })}#day`}>Следующие доставки этого дня →</Link>}
      <div className="ao-three">
        <TopMedicines insights={insights.data} />
        <PeakHours insights={insights.data} />
        <ClientsCard insights={insights.data} />
      </div>
    </div>;
  }

  if (view === 'finance') {
    const insights = await getAdminOrdersInsights(days);
    return <div className="ao"><Header view={view} days={days} /><FinanceView insights={insights.data} /></div>;
  }

  const status = params.status === 'all' ? undefined
    : statusFilters.some((filter) => filter.value === params.status) ? params.status as OrderFilter : 'active';
  const q = (params.q || '').trim();
  const createdFrom = params.created_from || '';
  const createdTo = params.created_to || '';
  const response = await listAdminOrders({
    q, status,
    createdFrom: createdFrom ? `${createdFrom}T00:00:00Z` : undefined,
    createdTo: createdTo ? `${createdTo}T23:59:59Z` : undefined,
    cursor: params.cursor, limit: 50,
  });
  const filterHref = (value: string) => href({ view: 'work', status: value, q, created_from: createdFrom, created_to: createdTo });

  return <div className="ao">
    <Header view={view} days={days} />
    <section className="ao-card ao-filters">
      <nav className="ao-status-tabs" aria-label="Статус заказов">
        {statusFilters.map((filter) => <Link key={filter.value} href={filterHref(filter.value)}
          className={(status ?? 'all') === filter.value ? 'active' : ''}>{filter.label}</Link>)}
      </nav>
      <form method="get" className="ao-search">
        <input type="hidden" name="view" value="work" />
        <input type="hidden" name="status" value={status ?? 'all'} />
        <input name="q" defaultValue={q} placeholder="Номер заказа, телефон или имя" aria-label="Поиск" />
        <label>с<input type="date" name="created_from" defaultValue={createdFrom} /></label>
        <label>по<input type="date" name="created_to" defaultValue={createdTo} /></label>
        <button type="submit">Найти</button>
      </form>
    </section>
    <OrderList key={`${status}-${q}-${createdFrom}-${createdTo}-${params.cursor || ''}`} initialOrders={response.data} />
    {response.page.has_more && response.page.next_cursor && <Link className="ao-more"
      href={href({ view: 'work', status: status ?? 'all', q, created_from: createdFrom, created_to: createdTo, cursor: response.page.next_cursor })}>
      Следующая страница →</Link>}
  </div>;
}

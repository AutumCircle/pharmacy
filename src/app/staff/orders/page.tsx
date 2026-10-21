import Link from 'next/link';
import { requireStaffSession } from '@/lib/staff-auth';
import { getCourierOrdersDaily, listCourierOrders, listPharmacyPreparationOrders } from '@/lib/api-v1/staff-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import type { CourierOrderList as CourierOrderListResponse } from '@/lib/api-v1/staff-types';
import {
  courierDaySummaryText, courierDayTitle, courierEmptyText, courierOrdersHref, courierStatusFilters,
  dushanbeDay, parseCourierDay, parseCourierFilter, parseCourierPeriod, shiftDay,
} from '@/lib/courier-day';
import CourierDayChart from './CourierDayChart';
import CourierOrderList from './CourierOrderList';
import PharmacyOrderCard from './PharmacyOrderCard';
import PharmacyAlertBanner from './PharmacyAlertBanner';
import NotificationPermission from './NotificationPermission';
import LiveRefresh from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

// Request time for the first paint of the waiting badge (same pattern as admin/orders).
function requestTime() {
  return new Date().getTime();
}

export default async function CourierOrdersPage({ searchParams }: {
  searchParams: Promise<{ status?: string; date?: string; period?: string; cursor?: string }>;
}) {
  const { account, token } = await requireStaffSession();
  const params = await searchParams;
  if (account.role === 'pharmacy') {
    const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
    const response = await listPharmacyPreparationOrders(token, { cursor, limit: 20 });
    const now = requestTime();
    return <section className="courier-orders-page">
      <LiveRefresh />
      <div className="staff-title-row"><div><h1>Заказы на сборку</h1>
        <p>Аптека {account.account_id} · заказы с сайта, ожидающие подготовки</p></div>
        <Link className="courier-new-order" href="/staff/orders">Обновить</Link>
      </div>
      <PharmacyAlertBanner initialCount={response.data.filter((order) => order.needs_attention === true).length} />
      <NotificationPermission />
      {response.data.length === 0 ? <div className="staff-order-form">Сейчас заказов на сборку нет.</div>
        : <div className="courier-order-list">{response.data.map((order) =>
          <PharmacyOrderCard key={order.order_id} order={order} now={now} pharmacyId={account.account_id} />)}</div>}
      {response.page.next_cursor && <div className="staff-pagination"><Link href={`/staff/orders?cursor=${encodeURIComponent(response.page.next_cursor)}`}>Следующие заказы →</Link></div>}
    </section>;
  }
  const status = parseCourierFilter(params.status);
  const day = parseCourierDay(params.date);
  const today = dushanbeDay(new Date(requestTime()));
  const yesterday = shiftDay(today, -1);
  const period = parseCourierPeriod(params.period);
  const cursor = params.cursor && params.cursor.length <= 500 ? params.cursor : undefined;
  const [listed, daily] = await Promise.all([
    listCourierOrders(token, { status: status || undefined, date: day, cursor, limit: 20 })
      .catch((error: unknown): null => {
        // A Lambda without the day / «Не доставлены» / «Отменённые» filters answers 400; show a notice, not a crash.
        if (!(error instanceof ApiV1Error && error.status === 400 && (day || status === 'undelivered' || status === 'cancelled'))) throw error;
        return null;
      }),
    // The chart is secondary: an older Lambda (no route) or a failed read hides it, the list still shows.
    getCourierOrdersDaily(token, period).catch(() => null),
  ]);
  const filterUnavailable = listed === null;
  const response: CourierOrderListResponse = listed ?? { data: [], page: { next_cursor: null, has_more: false }, request_id: '' };
  const next = response.page.next_cursor;
  const nextHref = next ? courierOrdersHref({ status, date: day, cursor: next, period }) : null;
  const days = [{ value: undefined, label: 'Все дни' }, { value: today, label: 'Сегодня' }, { value: yesterday, label: 'Вчера' }];

  return <section className="c-page">
    <LiveRefresh />
    <div className="c-page-head"><h1>Заказы</h1></div>
    <CourierDayChart daily={daily} selected={day} status={status} period={period} />
    <div className="c-days">
      <nav className="c-tabs" aria-label="День заказов">
        {days.map((option) => <Link key={option.label} className={day === option.value ? 'active' : ''}
          aria-current={day === option.value ? 'page' : undefined}
          href={courierOrdersHref({ status, date: option.value, period })}>{option.label}</Link>)}
      </nav>
      <form className="c-day-picker" action="/staff/orders">
        {status && <input type="hidden" name="status" value={status} />}
        {period === 70 && <input type="hidden" name="period" value="70" />}
        <label><span>Дата</span>
          <input type="date" name="date" defaultValue={day ?? ''} min="2020-01-01" max={today} /></label>
        <button className="c-btn c-btn-outline" type="submit">Показать</button>
      </form>
    </div>
    {day && <div className="c-day-summary" role="status">
      <strong>{courierDayTitle(day, today)}</strong>
      {response.summary && <span>{courierDaySummaryText(response.summary)}</span>}
    </div>}
    <nav className="c-tabs" aria-label="Статус заказов">
      {courierStatusFilters.map((filter) => <Link key={filter.value} className={status === filter.value ? 'active' : ''}
        aria-current={status === filter.value ? 'page' : undefined}
        href={courierOrdersHref({ status: filter.value, date: day, period })}>{filter.label}</Link>)}
    </nav>
    {filterUnavailable ? <div className="c-empty"><strong>Фильтр пока недоступен</strong>
      <span>Этот фильтр заработает после обновления сервера. Откройте «Все дни».</span></div>
      : <CourierOrderList orders={response.data} emptyText={courierEmptyText(status, day)} />}
    {nextHref && <Link className="c-btn c-btn-outline c-btn-wide c-more" href={nextHref}>Показать ещё</Link>}
  </section>;
}

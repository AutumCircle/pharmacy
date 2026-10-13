import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';
import { getCourierEarnings } from '@/lib/api-v1/staff-server';
import { money } from '../format';
import EarningsChart, { type EarningsDay } from './EarningsChart';

export const dynamic = 'force-dynamic';

function dushanbeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date());
}

function lastDays(count: number, today: string) {
  const end = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - (count - 1 - index));
    return day.toISOString().slice(0, 10);
  });
}

export default async function CourierEarningsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { account, token } = await requireStaffSession();
  if (account.role !== 'courier') redirect('/staff/orders');
  const period = (await searchParams).days === '30' ? 30 : 7;
  const response = await getCourierEarnings(token, { limit: period }).catch(() => null);
  const data = response?.data;
  const byDate = new Map((data?.daily ?? []).map((day) => [day.date, day]));
  const days: EarningsDay[] = lastDays(period, dushanbeToday()).map((date) => {
    const row = byDate.get(date);
    return { date, amount: Number(row?.amount ?? 0), orders: Number(row?.orders_count ?? 0),
      own: Number(row?.courier_orders_count ?? 0), site: Number(row?.website_orders_count ?? 0) };
  });
  const periodTotal = days.reduce((sum, day) => sum + day.amount, 0);
  const periodOrders = days.reduce((sum, day) => sum + day.orders, 0);

  return <section className="c-page">
    <div className="c-page-head"><h1>Заработок</h1></div>
    <div className="c-earn">
      <span><small>Сегодня</small><strong>{money(data?.today)}</strong></span>
      <span><small>Вчера</small><strong>{money(data?.yesterday)}</strong></span>
      <span><small>За всё время</small><strong>{money(data?.total)}</strong></span>
    </div>
    {!data ? <p className="c-error">Не удалось загрузить заработок. Обновите страницу.</p> : <>
      <section className="c-block c-chart-card">
        <div className="c-chart-head">
          <div><h2>По дням</h2><p className="c-muted c-small">{money(periodTotal)} · {periodOrders} доставок · нажмите на столбик</p></div>
          <nav className="c-segment c-segment-small" aria-label="Период">
            {[7, 30].map((value) => <Link key={value} href={value === 7 ? '/staff/earnings' : '/staff/earnings?days=30'}
              className={period === value ? 'active' : ''} aria-current={period === value ? 'page' : undefined}>{value} дней</Link>)}
          </nav>
        </div>
        <EarningsChart key={period} days={days} />
      </section>
      <section className="c-block">
        <h2 className="c-block-title">Список по дням</h2>
        {days.some((day) => day.orders > 0) ? <ul className="c-days">{[...days].reverse().filter((day) => day.orders > 0).map((day) =>
          <li key={day.date}>
            <span><strong>{new Date(`${day.date}T12:00:00+05:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}</strong>
              <small>{day.orders} дост. · сам {day.own} · с сайта {day.site}</small></span>
            <b>{money(day.amount)}</b>
          </li>)}</ul> : <p className="c-muted">За этот период доставок нет.</p>}
      </section>
    </>}
  </section>;
}

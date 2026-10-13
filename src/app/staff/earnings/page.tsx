import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';
import { getCourierEarnings } from '@/lib/api-v1/staff-server';
import { money } from '../format';

export const dynamic = 'force-dynamic';

export default async function CourierEarningsPage({ searchParams }: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { account, token } = await requireStaffSession();
  if (account.role !== 'courier') redirect('/staff/orders');
  const params = await searchParams;
  const cursor = /^\d{4}-\d{2}-\d{2}$/.test(params.cursor || '') ? params.cursor : undefined;
  const response = await getCourierEarnings(token, { cursor, limit: 31 }).catch(() => null);
  const data = response?.data;
  return <section className="c-page">
    <div className="c-page-head"><h1>Мой заработок</h1></div>
    <p className="c-muted c-page-sub">Считаются только доставленные заказы</p>
    <div className="c-earn c-earn-static">
      <span><small>Сегодня</small><strong>{money(data?.today)}</strong></span>
      <span><small>Вчера</small><strong>{money(data?.yesterday)}</strong></span>
      <span><small>Всего</small><strong>{money(data?.total)}</strong></span>
    </div>
    {!data && <p className="c-error">Не удалось загрузить заработок. Обновите страницу.</p>}
    {data && (data.daily.length ? <ul className="c-days">{data.daily.map((day) => <li key={day.date}>
      <span><strong>{new Date(`${day.date}T12:00:00+05:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}</strong>
        <small>{day.orders_count} {day.orders_count % 10 === 1 && day.orders_count % 100 !== 11 ? 'заказ'
          : [2, 3, 4].includes(day.orders_count % 10) && ![12, 13, 14].includes(day.orders_count % 100) ? 'заказа' : 'заказов'}</small></span>
      <b>{money(day.amount)}</b>
    </li>)}</ul> : <div className="c-empty"><strong>Пока пусто</strong><span>Заработок появится после первой доставки.</span></div>)}
    {data?.page.has_more && data.page.next_cursor &&
      <Link className="c-btn c-btn-outline c-btn-wide c-more" href={`/staff/earnings?cursor=${data.page.next_cursor}`}>Более ранние дни</Link>}
  </section>;
}

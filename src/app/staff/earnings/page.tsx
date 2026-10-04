import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';
import { getCourierEarnings } from '@/lib/api-v1/staff-server';

export const dynamic = 'force-dynamic';

export default async function CourierEarningsPage({ searchParams }: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { account, token } = await requireStaffSession();
  if (account.role !== 'courier') redirect('/staff/orders/new');
  const params = await searchParams;
  const cursor = /^\d{4}-\d{2}-\d{2}$/.test(params.cursor || '') ? params.cursor : undefined;
  const response = await getCourierEarnings(token, { cursor, limit: 31 }).catch(() => null);
  const data = response?.data;
  return <section className="courier-earnings-page">
    <div className="staff-title-row"><div><h1>Мой заработок</h1><p>Учитываются только доставленные заказы</p></div>
      <Link className="courier-new-order" href="/staff/orders">← Заказы</Link></div>
    <div className="courier-earnings-summary">
      <article><span>За всё время</span><strong>{Number(data?.total ?? 0).toLocaleString('ru-RU')} с.</strong></article>
      <article><span>Сегодня</span><strong>{Number(data?.today ?? 0).toLocaleString('ru-RU')} с.</strong></article>
      <article><span>Вчера</span><strong>{Number(data?.yesterday ?? 0).toLocaleString('ru-RU')} с.</strong></article>
    </div>
    {!data && <p className="staff-order-warning">История появится в Preview после публикации утверждённой backend-части.</p>}
    <div className="staff-table-wrap"><table className="staff-table courier-daily-table">
      <thead><tr><th>Дата</th><th>Доставлено заказов</th><th>Заработано</th></tr></thead>
      <tbody>{data?.daily.length ? data.daily.map((day) => <tr key={day.date}>
        <td>{new Date(`${day.date}T12:00:00+05:00`).toLocaleDateString('ru-RU')}</td>
        <td>{day.orders_count}</td><td className="staff-price">{Number(day.amount).toLocaleString('ru-RU')} с.</td>
      </tr>) : <tr><td className="staff-empty" colSpan={3}>Данных пока нет.</td></tr>}</tbody>
    </table></div>
    {data?.page.has_more && data.page.next_cursor && <div className="staff-pagination">
      <Link href={`/staff/earnings?cursor=${data.page.next_cursor}`}>Более ранние дни →</Link></div>}
  </section>;
}

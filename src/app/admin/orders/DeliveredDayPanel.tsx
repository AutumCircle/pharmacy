import Link from 'next/link';
import type { DeliveredDayResponse } from '@/lib/api-v1/admin-types';
import { formatOrderDateTime } from '@/lib/order-time';

const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Телефон' } as const;

function percentage(count: number, total: number) {
  return total > 0 ? Math.round(count / total * 1000) / 10 : 0;
}

export default function DeliveredDayPanel({ report, today, yesterday }: {
  report: DeliveredDayResponse; today: string; yesterday: string;
}) {
  const { summary } = report;
  const dateLabel = new Date(`${report.date}T12:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
  const websitePercent = percentage(summary.website, summary.total);
  const courierPercent = percentage(summary.courier, summary.total);
  const pharmacyPercent = percentage(summary.pharmacy, summary.total);
  const websiteEnd = websitePercent;
  const courierEnd = websiteEnd + courierPercent;
  const chartStyle = summary.total
    ? { background: `conic-gradient(#b5121b 0 ${websiteEnd}%, #ef8f3c ${websiteEnd}% ${courierEnd}%, #586674 ${courierEnd}% 100%)` }
    : { background: '#e8ebed' };
  const nextParams = new URLSearchParams({ view: 'day', date: report.date });
  if (report.page.next_cursor) nextParams.set('cursor', report.page.next_cursor);

  return <section className="admin-delivery-day">
    <div className="admin-delivery-day-controls">
      <form method="get"><input type="hidden" name="view" value="day" />
        <label htmlFor="delivered-date">День доставки</label>
        <input id="delivered-date" type="date" name="date" defaultValue={report.date} min="2020-01-01" max="2100-12-31" required />
        <button type="submit">Показать</button>
      </form>
      <div className="admin-delivery-day-shortcuts">
        <Link href={`/admin/orders?view=day&date=${today}`}>Сегодня</Link>
        <Link href={`/admin/orders?view=day&date=${yesterday}`}>Вчера</Link>
      </div>
    </div>
    <p className="admin-delivery-day-timezone">Дата и время — Душанбе. Считается день перехода заказа в статус «Доставлен», а не день его создания.</p>
    <div className="admin-delivery-day-summary">
      <div className="admin-delivery-day-count"><span>Доставлено за {dateLabel}</span><strong>{summary.total}</strong><small>заказов</small></div>
      <div className="admin-delivery-day-pie" style={chartStyle} role="img"
        aria-label={`С сайта ${summary.website} (${websitePercent}%), внёс курьер ${summary.courier} (${courierPercent}%), сотрудник аптеки ${summary.pharmacy} (${pharmacyPercent}%)`}>
        <div><strong>{summary.total}</strong><span>заказов</span></div>
      </div>
      <div className="admin-delivery-day-legend">
        <div><i className="website" /><span>Клиенты сайта</span><strong>{summary.website}</strong><small>{websitePercent}%</small></div>
        <div><i className="courier" /><span>Внёс курьер</span><strong>{summary.courier}</strong><small>{courierPercent}%</small></div>
        {summary.pharmacy > 0 && <div><i className="pharmacy" /><span>Сотрудники аптек</span><strong>{summary.pharmacy}</strong><small>{pharmacyPercent}%</small></div>}
        {summary.courier > 0 && <p>Из заказов курьера: WhatsApp — {summary.whatsapp}, Instagram — {summary.instagram}, звонок — {summary.phone}
          {summary.courier > summary.whatsapp + summary.instagram + summary.phone
            ? `, источник не указан — ${summary.courier - summary.whatsapp - summary.instagram - summary.phone}` : ''}.</p>}
      </div>
    </div>
    <h2>Доставленные заказы</h2>
    {report.data.length === 0 ? <p className="admin-delivery-day-empty">В этот день доставленных заказов нет. Выберите другую дату.</p>
      : <div className="admin-delivery-day-list">{report.data.map((order) => <article key={order.order_id}>
        <div><Link href={`/admin/orders/${encodeURIComponent(order.order_id)}`}>Заказ {order.order_reference || order.order_id}</Link>
          <time dateTime={order.delivered_at}>Доставлен {formatOrderDateTime(order.delivered_at)}</time></div>
        <div><strong>{order.created_by_staff_account_id === null ? 'Клиент сайта' : order.created_by_staff_account_id === 3
          ? 'Внёс курьер' : `Сотрудник аптеки ${order.created_by_staff_account_id}`}</strong>
          {order.order_source && <span> · {sourceLabels[order.order_source]}</span>}
          <p>{order.customer_name || 'Имя не указано'} · {order.phone}</p></div>
        <div className="admin-delivery-day-amount">{Number(order.order_total || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} с.</div>
      </article>)}</div>}
    {report.page.has_more && report.page.next_cursor && <Link className="admin-delivery-day-next"
      href={`/admin/orders?${nextParams.toString()}`}>Следующие 30 заказов →</Link>}
  </section>;
}

import Link from 'next/link';
import type { DeliveredDayResponse, OrdersInsights } from '@/lib/api-v1/admin-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { ORIGIN_COLORS, count, dayLabel, money, origin, percent } from './ui';

const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Звонок' } as const;

export function KpiGrid({ insights }: { insights: OrdersInsights }) {
  const t = insights.totals;
  const clientsTotal = insights.clients.new_clients + insights.clients.returning_clients;
  const cards = [
    { label: 'Заказали', value: money(t.ordered_sum), hint: count(t.ordered_count, 'заказ', 'заказа', 'заказов') },
    { label: 'Доставлено', value: money(t.delivered_sum), hint: count(t.delivered_count, 'доставка', 'доставки', 'доставок'), accent: true },
    { label: 'Средний чек', value: money(t.average_check), hint: 'по доставленным' },
    { label: 'Прибыль с товаров', value: money(t.profit), hint: 'цена клиента − цена аптеки' },
    { label: 'Отменено', value: String(t.cancelled_count), hint: t.ordered_count + t.cancelled_count
      ? `${percent(t.cancelled_count, t.ordered_count + t.cancelled_count)}% заказов` : 'заказов' },
    { label: 'Клиенты', value: String(clientsTotal),
      hint: `${insights.clients.new_clients} новых · ${insights.clients.returning_clients} постоянных` },
  ];
  return <section className="ao-kpis" aria-label="Итоги периода">
    {cards.map((card) => <article key={card.label} className={card.accent ? 'ao-kpi ao-kpi-accent' : 'ao-kpi'}>
      <span>{card.label}</span><strong>{card.value}</strong><small>{card.hint}</small>
    </article>)}
  </section>;
}

export function DailyChart({ insights, selected, hrefFor }: {
  insights: OrdersInsights; selected: string; hrefFor: (date: string) => string;
}) {
  const days = insights.daily;
  const peak = Math.max(1, ...days.map((day) => day.website_orders + day.courier_orders + day.pharmacy_orders));
  const dense = days.length > 14;
  const hasPharmacy = days.some((day) => day.pharmacy_orders > 0);
  const step = days.length > 31 ? 10 : 5;
  return <section className="ao-card ao-chart-card">
    <div className="ao-card-head">
      <div><h2>Доставки по дням</h2><p>Нажмите на столбик, чтобы открыть день</p></div>
      <div className="ao-legend">
        <span><i style={{ background: ORIGIN_COLORS.website }} />Сайт</span>
        <span><i style={{ background: ORIGIN_COLORS.courier }} />Создал курьер</span>
        {hasPharmacy && <span><i style={{ background: ORIGIN_COLORS.pharmacy }} />Аптеки</span>}
      </div>
    </div>
    <div className="ao-bars-wrap">
      <span className="ao-axis-max">{peak}</span>
      <div className="ao-bars" style={{ gap: dense ? 2 : 8 }}>
        {days.map((day, index) => {
          const total = day.website_orders + day.courier_orders + day.pharmacy_orders;
          const sales = Number(day.website_sales) + Number(day.courier_sales) + Number(day.pharmacy_sales);
          const active = day.date === selected;
          const label = dense ? (index % step === (days.length - 1) % step ? dayLabel(day.date, { day: 'numeric' }) : '')
            : dayLabel(day.date, { weekday: 'short', day: 'numeric' });
          return <Link key={day.date} href={hrefFor(day.date)} scroll={false} className={active ? 'ao-col active' : 'ao-col'}
            aria-current={active ? 'date' : undefined}
            aria-label={`${dayLabel(day.date, { day: 'numeric', month: 'long' })}: ${total} доставок, сайт ${day.website_orders}, курьер ${day.courier_orders}, ${money(sales)}`}>
            <span className="ao-col-plot">
              {total > 0 && <span className="ao-stack" style={{ height: `${Math.max(3, total / peak * 100)}%` }}>
                {day.pharmacy_orders > 0 && <span style={{ flexGrow: day.pharmacy_orders, background: ORIGIN_COLORS.pharmacy }} />}
                {day.courier_orders > 0 && <span style={{ flexGrow: day.courier_orders, background: ORIGIN_COLORS.courier }} />}
                {day.website_orders > 0 && <span style={{ flexGrow: day.website_orders, background: ORIGIN_COLORS.website }} />}
              </span>}
              <span className="ao-tip" aria-hidden="true">
                <b>{dayLabel(day.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
                <span>Сайт: {day.website_orders}</span><span>Курьер: {day.courier_orders}</span>
                {day.pharmacy_orders > 0 && <span>Аптеки: {day.pharmacy_orders}</span>}
                <span>{money(sales)}</span>
              </span>
            </span>
            <span className="ao-col-x">{label}</span>
          </Link>;
        })}
      </div>
    </div>
  </section>;
}

function Donut({ parts, center, sub }: { parts: Array<{ value: number; color: string }>; center: string; sub: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 52, circumference = 2 * Math.PI * radius;
  const visible = parts.filter((part) => part.value > 0);
  const gap = visible.length > 1 ? 3 : 0;
  let offset = 0;
  return <svg viewBox="0 0 140 140" className="ao-donut" role="img" aria-label={`${center} ${sub}`}>
    <circle cx="70" cy="70" r={radius} fill="none" stroke="#edf0ee" strokeWidth="18" />
    {total > 0 && visible.map((part, index) => {
      const length = part.value / total * circumference;
      const dash = Math.max(0, length - gap);
      const element = <circle key={index} cx="70" cy="70" r={radius} fill="none" stroke={part.color} strokeWidth="18"
        strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
      offset += length;
      return element;
    })}
    <text x="70" y="68" textAnchor="middle" className="ao-donut-value">{center}</text>
    <text x="70" y="88" textAnchor="middle" className="ao-donut-sub">{sub}</text>
  </svg>;
}

export function DayPanel({ report, prevHref, nextHref, isToday }: {
  report: DeliveredDayResponse; prevHref: string; nextHref: string | null; isToday: boolean;
}) {
  const s = report.summary;
  const website = Number(s.website_sales ?? 0), courier = Number(s.courier_sales ?? 0), pharmacy = Number(s.pharmacy_sales ?? 0);
  const totalSales = Number(s.total_sales ?? website + courier + pharmacy);
  const ownerDelivered = s.owner_delivered ?? 0;
  const rows = [
    { key: 'website' as const, label: 'Заказы с сайта', sales: website, orders: s.website },
    { key: 'courier' as const, label: 'Создал курьер', sales: courier, orders: s.courier },
    ...(s.pharmacy ? [{ key: 'pharmacy' as const, label: 'Аптеки', sales: pharmacy, orders: s.pharmacy }] : []),
  ];
  return <section className="ao-card ao-day" id="day">
    <div className="ao-card-head">
      <div><span className="ao-eyebrow">{isToday ? 'Сегодня' : 'День доставки'}</span>
        <h2>{dayLabel(report.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2></div>
      <nav className="ao-day-nav" aria-label="Другой день">
        <Link href={prevHref} scroll={false} aria-label="Предыдущий день">‹</Link>
        {nextHref ? <Link href={nextHref} scroll={false} aria-label="Следующий день">›</Link> : <span aria-hidden="true">›</span>}
      </nav>
    </div>
    <div className="ao-day-grid">
      <div className="ao-day-stats">
        <article><span>Доставлено на сумму</span><strong>{money(totalSales)}</strong></article>
        <article><span>Доставок</span><strong>{s.total}</strong></article>
        <article><span>Доставил курьер</span><strong>{s.total - ownerDelivered}</strong><small>{money(s.courier_fee)} за доставку</small></article>
        <article><span>Доставили вы</span><strong>{ownerDelivered}</strong><small>{money(s.owner_fee)} вам за доставку</small></article>
      </div>
      <div className="ao-day-pie">
        <Donut parts={rows.map((row) => ({ value: row.sales, color: ORIGIN_COLORS[row.key] }))}
          center={money(totalSales)} sub="сумма дня" />
        <ul className="ao-pie-legend">
          {rows.map((row) => <li key={row.key}>
            <i style={{ background: ORIGIN_COLORS[row.key] }} />
            <span>{row.label}<small>{count(row.orders, 'заказ', 'заказа', 'заказов')}</small></span>
            <b>{percent(row.sales, totalSales)}%</b><em>{money(row.sales)}</em>
          </li>)}
        </ul>
      </div>
    </div>
    <h3 className="ao-subhead">Доставки этого дня</h3>
    {report.data.length === 0 ? <p className="ao-empty">В этот день доставок нет.</p>
      : <ul className="ao-rows">{report.data.map((order) => {
        const from = origin(order.created_by_staff_account_id);
        return <li key={order.order_id}><Link href={`/admin/orders/${encodeURIComponent(order.order_id)}`} className="ao-row">
          <span className="ao-row-time">{formatOrderDateTime(order.delivered_at).split(', ').pop()}</span>
          <span className="ao-row-main"><strong>№ {order.order_reference || order.order_id.slice(-6)} · {order.customer_name || 'Без имени'}</strong>
            <small>{order.address}{order.order_source ? ` · ${sourceLabels[order.order_source]}` : ''}</small></span>
          <span className={`ao-origin ao-origin-${from.key}`}>{from.label}</span>
          <b className="ao-row-sum">{money(order.order_total)}</b>
        </Link></li>;
      })}</ul>}
  </section>;
}

export function TopMedicines({ insights }: { insights: OrdersInsights }) {
  const items = insights.top_medicines;
  const peak = Math.max(1, ...items.map((item) => Number(item.sales)));
  return <section className="ao-card">
    <div className="ao-card-head"><div><h2>Топ лекарств</h2><p>По сумме в доставленных заказах</p></div></div>
    {items.length === 0 ? <p className="ao-empty">Пока нет доставленных заказов.</p> : <ol className="ao-top">
      {items.map((item) => <li key={item.medicine_name}>
        <div><strong>{item.medicine_name}</strong><b>{money(item.sales)}</b></div>
        <span className="ao-meter"><span style={{ width: `${Number(item.sales) / peak * 100}%` }} /></span>
        <small>{Number(item.quantity).toLocaleString('ru-RU')} шт. · {count(item.orders, 'заказ', 'заказа', 'заказов')}</small>
      </li>)}
    </ol>}
  </section>;
}

export function PeakHours({ insights }: { insights: OrdersInsights }) {
  const hours = insights.hours;
  const peak = Math.max(1, ...hours.map((hour) => hour.orders));
  const best = hours.reduce((top, hour) => hour.orders > top.orders ? hour : top, hours[0]);
  return <section className="ao-card">
    <div className="ao-card-head"><div><h2>Часы пик</h2>
      <p>{best && best.orders ? `Больше всего заказов в ${best.hour}:00–${best.hour + 1}:00` : 'Заказов за период нет'}</p></div></div>
    <div className="ao-hours" role="img" aria-label={hours.map((hour) => `${hour.hour}:00 — ${hour.orders}`).join(', ')}>
      {hours.map((hour) => <span key={hour.hour} className={hour === best && hour.orders ? 'ao-hour best' : 'ao-hour'}
        title={`${hour.hour}:00–${hour.hour + 1}:00 · ${hour.orders}`}>
        <span style={{ height: `${hour.orders / peak * 100}%` }} />
      </span>)}
    </div>
    <div className="ao-hours-x" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
  </section>;
}

export function ClientsCard({ insights }: { insights: OrdersInsights }) {
  const { new_clients: fresh, returning_clients: returning } = insights.clients;
  const total = fresh + returning;
  return <section className="ao-card">
    <div className="ao-card-head"><div><h2>Клиенты</h2><p>Уникальные номера за период</p></div></div>
    <div className="ao-split" role="img" aria-label={`Новые ${fresh}, постоянные ${returning}`}>
      {total > 0 ? <>
        <span style={{ flexGrow: fresh, background: '#1d5f9a' }} />
        <span style={{ flexGrow: returning, background: '#187a3c' }} />
      </> : <span style={{ flexGrow: 1, background: '#edf0ee' }} />}
    </div>
    <ul className="ao-split-legend">
      <li><i style={{ background: '#1d5f9a' }} />Новые<b>{fresh}</b><small>{percent(fresh, total)}%</small></li>
      <li><i style={{ background: '#187a3c' }} />Постоянные<b>{returning}</b><small>{percent(returning, total)}%</small></li>
    </ul>
  </section>;
}

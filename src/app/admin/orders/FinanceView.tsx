import Link from 'next/link';
import type { OrdersInsights } from '@/lib/api-v1/admin-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { courierAveragePerDay } from './insights-metrics';
import { count, dayLabel, money, origin } from './ui';

function DayBars({ title, hint, values, color }: {
  title: string; hint: string; values: Array<{ date: string; value: number; note: string }>; color: string;
}) {
  const peak = Math.max(1, ...values.map((entry) => entry.value));
  const dense = values.length > 14;
  return <section className="ao-card">
    <div className="ao-card-head"><div><h2>{title}</h2><p>{hint}</p></div></div>
    <div className="ao-bars-wrap">
      <span className="ao-axis-max">{money(peak)}</span>
      <div className="ao-bars" style={{ gap: dense ? 2 : 8 }}>
        {values.map((entry, index) => <span key={entry.date} className="ao-col" tabIndex={0}
          aria-label={`${dayLabel(entry.date, { day: 'numeric', month: 'long' })}: ${money(entry.value)}, ${entry.note}`}>
          <span className="ao-col-plot">
            {entry.value > 0 && <span className="ao-stack" style={{ height: `${Math.max(3, entry.value / peak * 100)}%` }}>
              <span style={{ flexGrow: 1, background: color }} /></span>}
            <span className="ao-tip" aria-hidden="true"><b>{dayLabel(entry.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
              <span>{money(entry.value)}</span><span>{entry.note}</span></span>
          </span>
          <span className="ao-col-x">{dense ? (index % 5 === (values.length - 1) % 5 ? dayLabel(entry.date, { day: 'numeric' }) : '')
            : dayLabel(entry.date, { weekday: 'short', day: 'numeric' })}</span>
        </span>)}
      </div>
    </div>
  </section>;
}

export default function FinanceView({ insights }: { insights: OrdersInsights }) {
  const t = insights.totals;
  const ownerTotal = Number(t.profit) + Number(t.owner_fee);
  const courierDeliveries = t.delivered_count - t.owner_delivered;
  const courierPerDay = courierAveragePerDay(insights.daily);
  return <>
    <section className="ao-finance-top">
      <article className="ao-money-card ao-money-owner">
        <span className="ao-eyebrow">Ваш заработок</span>
        <strong>{money(ownerTotal)}</strong>
        <dl>
          <div><dt>Прибыль с товаров</dt><dd>{money(t.profit)}</dd></div>
          <div><dt>Ваша часть доставки</dt><dd>{money(t.owner_fee)}</dd></div>
          <div><dt>Доставили сами</dt><dd>{count(t.owner_delivered, 'заказ', 'заказа', 'заказов')}</dd></div>
        </dl>
      </article>
      <article className="ao-money-card ao-money-courier">
        <span className="ao-eyebrow">Заработок курьера</span>
        <strong>{money(t.courier_fee)}</strong>
        <dl>
          <div><dt>Доставил заказов</dt><dd>{courierDeliveries}</dd></div>
          <div><dt>В среднем за доставку</dt><dd>{money(courierDeliveries ? Number(t.courier_fee) / courierDeliveries : 0)}</dd></div>
          <div><dt>В среднем за день<small>за {count(courierPerDay.workingDays, 'день', 'дня', 'дней')} с доставками</small></dt>
            <dd>{money(courierPerDay.average)}</dd></div>
          <div><dt>Оборот доставленных</dt><dd>{money(t.delivered_sum)}</dd></div>
        </dl>
      </article>
    </section>
    <div className="ao-two">
      <DayBars title="Ваш заработок по дням" hint="Прибыль с товаров + ваша часть доставки" color="#187a3c"
        values={insights.daily.map((day) => ({ date: day.date, value: Number(day.profit) + Number(day.owner_fee),
          note: `вы доставили: ${day.owner_delivered}` }))} />
      <DayBars title="Курьер по дням" hint="Сумма, которую курьер получил за доставку" color="#1d5f9a"
        values={insights.daily.map((day) => ({ date: day.date, value: Number(day.courier_fee),
          note: `доставок: ${day.website_orders + day.courier_orders + day.pharmacy_orders - day.owner_delivered}` }))} />
    </div>
    <section className="ao-card">
      <div className="ao-card-head"><div><h2>Доставленные заказы</h2><p>По дате доставки · до 200 последних</p></div></div>
      {insights.delivered_orders.length === 0 ? <p className="ao-empty">За период доставок нет.</p> : <div className="ao-table-wrap">
        <table className="ao-table">
          <thead><tr><th>Заказ</th><th>Доставлен</th><th>Откуда</th><th>Кто доставил</th>
            <th className="num">Прибыль</th><th className="num">Вам за доставку</th><th className="num">Курьеру</th><th className="num">Ваш итог</th></tr></thead>
          <tbody>{insights.delivered_orders.map((order) => {
            const from = origin(order.created_by_staff_account_id);
            const ownerDelivered = Number(order.delivery_owner_amount) > 0 && Number(order.delivery_courier_amount) === 0;
            return <tr key={order.order_id}>
              <td><Link href={`/admin/orders/${encodeURIComponent(order.order_id)}`}>№ {order.order_reference || order.order_id.slice(-6)}</Link>
                <small>{order.customer_name || 'Без имени'}</small></td>
              <td>{formatOrderDateTime(order.delivered_at)}</td>
              <td><span className={`ao-origin ao-origin-${from.key}`}>{from.label}</span></td>
              <td>{ownerDelivered ? 'Вы' : Number(order.delivery_owner_amount) > 0 ? 'Вместе' : 'Курьер'}</td>
              <td className="num">{money(order.profit)}</td>
              <td className="num">{money(order.delivery_owner_amount)}</td>
              <td className="num">{money(order.delivery_courier_amount)}</td>
              <td className="num"><b>{money(order.owner_total)}</b></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </section>
  </>;
}

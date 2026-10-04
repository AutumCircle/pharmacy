import Link from 'next/link';
import type { AdminDashboardSummary } from '@/lib/api-v1/admin-types';

type Props = {
  summary: AdminDashboardSummary;
  days: 7 | 30 | 90;
  compact?: boolean;
};

function money(value: number, currency: string) {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function OrderEarningsPanel({ summary, days, compact = false }: Props) {
  const orderProfit = Number(summary.online_profit_total ?? summary.profit_total) || 0;
  const ownerDelivery = Number(summary.delivery_owner_total) || 0;
  const courierDelivery = Number(summary.delivery_courier_total) || 0;
  const ownerTotal = orderProfit + ownerDelivery;
  const distributionTotal = ownerTotal + courierDelivery;
  const orderPercent = distributionTotal > 0 ? orderProfit / distributionTotal * 100 : 0;
  const ownerDeliveryPercent = distributionTotal > 0 ? ownerDelivery / distributionTotal * 100 : 0;
  const courierPercent = distributionTotal > 0 ? courierDelivery / distributionTotal * 100 : 0;
  const pieStyle = distributionTotal > 0
    ? { background: `conic-gradient(#b5121b 0 ${orderPercent}%, #ef8f3c ${orderPercent}% ${orderPercent + ownerDeliveryPercent}%, #586674 ${orderPercent + ownerDeliveryPercent}% 100%)` }
    : { background: '#e8ebed' };

  return (
    <section className={`order-earnings-panel${compact ? ' compact' : ''}`}>
      <div className="order-earnings-heading">
        <div>
          <span>Финансы доставленных заказов</span>
          <h2>{compact ? 'Ваш заработок' : 'Заработок по заказам и доставке'}</h2>
        </div>
        <nav className="order-earnings-periods" aria-label="Период финансов">
          {[7, 30, 90].map((period) => (
            <Link key={period} href={`${compact ? '/admin' : '/admin/orders'}?days=${period}`}
              className={period === days ? 'active' : ''}>{period} дней</Link>
          ))}
        </nav>
      </div>

      <div className="order-earnings-cards">
        <article><span>С онлайн-заказов</span><strong>{money(orderProfit, summary.currency)}</strong></article>
        <article><span>Ваша часть доставки</span><strong>{money(ownerDelivery, summary.currency)}</strong></article>
        <article className="total"><span>Ваш общий заработок</span><strong>{money(ownerTotal, summary.currency)}</strong></article>
        <article className="courier"><span>Получил курьер</span><strong>{money(courierDelivery, summary.currency)}</strong></article>
      </div>

      {!compact && (
        <><div className="order-earnings-chart-layout">
          <div className="order-earnings-pie" style={pieStyle} role="img"
            aria-label={`С онлайн-заказов ${money(orderProfit, summary.currency)}, ваша часть доставки ${money(ownerDelivery, summary.currency)}, курьер получил ${money(courierDelivery, summary.currency)}`}>
            <div><strong>{money(ownerTotal, summary.currency)}</strong><span>ваш итог</span></div>
          </div>
          <div className="order-earnings-legend">
            <div><i className="orders" /><span>С онлайн-заказов</span><strong>{money(orderProfit, summary.currency)}</strong><small>{orderPercent.toFixed(1)}%</small></div>
            <div><i className="owner-delivery" /><span>Ваша часть доставки</span><strong>{money(ownerDelivery, summary.currency)}</strong><small>{ownerDeliveryPercent.toFixed(1)}%</small></div>
            <div><i className="courier-delivery" /><span>Заработал курьер</span><strong>{money(courierDelivery, summary.currency)}</strong><small>{courierPercent.toFixed(1)}%</small></div>
          </div>
        </div>
        <div className="order-earnings-history">
          <h3>Заработок по каждому доставленному заказу</h3>
          {summary.delivered_orders.length === 0 ? <p>За выбранный период доставленных заказов нет.</p> :
            <div className="order-earnings-table-wrap"><table>
              <thead><tr><th>Заказ</th><th>Дата</th><th>С заказа</th><th>Ваша доставка</th><th>Курьер</th><th>Ваш итог</th></tr></thead>
              <tbody>{summary.delivered_orders.map((order) => {
                const profit = Number(order.profit) || 0;
                const ownerDeliveryForOrder = Number(order.delivery_owner_amount ?? 0) || 0;
                const courierForOrder = Number(order.delivery_courier_amount ?? 0) || 0;
                const total = Number(order.owner_total ?? profit + ownerDeliveryForOrder) || 0;
                return <tr key={order.order_id}>
                  <td><Link href={`/admin/orders/${order.order_id}`}>№ {order.order_reference}</Link></td>
                  <td>{new Date(order.created_at).toLocaleDateString('ru-RU', { timeZone: 'Asia/Dushanbe' })}</td>
                  <td className={profit > 0 ? 'positive-earning' : ''}>{money(profit, summary.currency)}</td>
                  <td className={ownerDeliveryForOrder > 0 ? 'positive-earning' : ''}>{money(ownerDeliveryForOrder, summary.currency)}</td>
                  <td className={courierForOrder > 0 ? 'positive-earning' : ''}>{money(courierForOrder, summary.currency)}</td>
                  <td className={total > 0 ? 'positive-earning' : ''}><strong>{money(total, summary.currency)}</strong></td>
                </tr>;
              })}</tbody>
            </table></div>}
        </div></>
      )}
      {compact && <Link className="order-earnings-details" href={`/admin/orders?days=${days}`}>Открыть диаграмму в заказах →</Link>}
    </section>
  );
}

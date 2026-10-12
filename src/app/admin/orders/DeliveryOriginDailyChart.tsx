import type { AdminDashboardSummary } from '@/lib/api-v1/admin-types';

const money = (value: number | string) => `${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} с.`;

export default function DeliveryOriginDailyChart({ daily }: { daily: AdminDashboardSummary['delivery_origin_daily'] }) {
  const peak = Math.max(1, ...daily.map((row) => row.website_orders + row.courier_orders + row.pharmacy_orders));
  return <section style={{ background: 'white', padding: 20, borderRadius: 12, marginBottom: 20 }}>
    <h2 style={{ marginTop: 0 }}>Доставленные заказы по дням</h2>
    <p style={{ color: '#667085' }}>Дата доставки по Душанбе. Продажи — только лекарства, без доставки.</p>
    <div aria-label="Легенда"><span style={{ color: '#b5121b' }}>■ Клиенты сайта</span>{' · '}<span style={{ color: '#ef8f3c' }}>■ Внёс курьер</span>{' · '}<span style={{ color: '#586674' }}>■ Аптеки (отдельно)</span></div>
    <div role="img" aria-label="По каждому дню показано число доставленных заказов сайта и курьера; аптечные заказы выделены отдельно" style={{ display: 'flex', alignItems: 'end', gap: 5, height: 190, overflowX: 'auto', marginTop: 16, borderBottom: '1px solid #d0d5dd' }}>
      {daily.map((row) => { const total = row.website_orders + row.courier_orders + row.pharmacy_orders; return <div key={row.date} title={`${row.date}: сайт ${row.website_orders}, курьер ${row.courier_orders}, аптеки ${row.pharmacy_orders}`} style={{ minWidth: 30, flex: '1 0 30px', height: `${Math.max(total ? 4 : 0, total / peak * 100)}%`, display: 'flex', flexDirection: 'column', justifyContent: 'end' }}>
        <small style={{ textAlign: 'center', fontWeight: 700 }}>{total || ''}</small><div style={{ background: '#b5121b', height: `${row.website_orders / peak * 100}%`, minHeight: row.website_orders ? 3 : 0 }} /><div style={{ background: '#ef8f3c', height: `${row.courier_orders / peak * 100}%`, minHeight: row.courier_orders ? 3 : 0 }} /><div style={{ background: '#586674', height: `${row.pharmacy_orders / peak * 100}%`, minHeight: row.pharmacy_orders ? 3 : 0 }} /></div>; })}
    </div>
    <details style={{ marginTop: 16 }}><summary>Доступная таблица: суммы и количество по дням</summary><div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>День доставки</th><th>Сайт</th><th>Курьер</th><th>Аптеки</th><th>Всего лекарств</th></tr></thead><tbody>{daily.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.website_orders} · {money(row.website_sales)}</td><td>{row.courier_orders} · {money(row.courier_sales)}</td><td>{row.pharmacy_orders} · {money(row.pharmacy_sales)}</td><td>{money(Number(row.website_sales) + Number(row.courier_sales) + Number(row.pharmacy_sales))}</td></tr>)}</tbody></table></div></details>
  </section>;
}

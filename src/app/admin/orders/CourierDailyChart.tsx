import type { AdminDashboardSummary } from '@/lib/api-v1/admin-types';

export default function CourierDailyChart({ daily, days }: {
  daily: AdminDashboardSummary['courier_daily']; days: number;
}) {
  const peak = Math.max(1, ...daily.map((entry) => Number(entry.amount) || 0));
  return <section style={{ background: 'white', padding: 20, borderRadius: 12, marginTop: 24 }}>
    <h2 style={{ margin: '0 0 6px' }}>Заработок доставщика по дням</h2>
    <p style={{ color: '#667085', margin: '0 0 18px' }}>Последние {days} дней · только доставленные заказы · дата доставки по Душанбе</p>
    {daily.length === 0 ? <p>Данных пока нет.</p> : <>
      <div role="img" aria-label="График ежедневного заработка доставщика" style={{ display: 'flex', alignItems: 'end', gap: days === 90 ? 2 : 5, height: 180, overflowX: 'auto', borderBottom: '1px solid #d0d5dd' }}>
        {daily.map((entry) => {
          const amount = Number(entry.amount) || 0;
          return <div key={entry.date} title={`${entry.date}: ${amount.toFixed(2)} с. · заказов: ${entry.orders_count}`}
            style={{ flex: '1 0 3px', minWidth: days === 90 ? 3 : 8, height: `${Math.max(amount > 0 ? 3 : 0, amount / peak * 100)}%`,
              background: amount > 0 ? '#b5121b' : 'transparent', borderRadius: '3px 3px 0 0' }} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#667085', fontSize: 12, marginTop: 5 }}>
        <span>{daily[0].date}</span><span>{daily[daily.length - 1].date}</span>
      </div>
      <details style={{ marginTop: 18 }}><summary>Суммы по каждому дню</summary>
        <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10 }}>
          {daily.map((entry) => <div key={entry.date} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid #eee' }}>
            <span>{entry.date} · {entry.orders_count} заказов</span><strong>{Number(entry.amount).toFixed(2)} с.</strong>
          </div>)}
        </div>
      </details>
    </>}
  </section>;
}

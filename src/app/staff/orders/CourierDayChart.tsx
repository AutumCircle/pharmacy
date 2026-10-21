import Link from 'next/link';
import type { CourierOrderFilter, CourierOrdersDaily } from '@/lib/api-v1/staff-types';
import { courierChartBarText, courierChartLabel, courierOrdersHref, type CourierChartPeriod } from '@/lib/courier-day';

/** Orders per Dushanbe day (same look as the admin «Доставки по дням»); a bar opens that day's list. */
export default function CourierDayChart({ daily, selected, status, period }: {
  daily: CourierOrdersDaily | null; selected?: string; status: CourierOrderFilter | ''; period: CourierChartPeriod;
}) {
  const days = daily?.data ?? [];
  const peak = Math.max(1, ...days.map((day) => day.total));
  const periods: CourierChartPeriod[] = [30, 70];
  return <section className="c-chart" aria-label="Заказы по дням">
    <div className="c-chart-head">
      <div><h2>Заказы по дням</h2><p>Нажмите на столбик, чтобы открыть день</p></div>
      <nav className="c-chart-periods" aria-label="Период графика">
        {periods.map((value) => <Link key={value} className={value === period ? 'active' : ''}
          aria-current={value === period ? 'page' : undefined} scroll={false}
          href={courierOrdersHref({ status, date: selected, period: value })}>{value} дней</Link>)}
      </nav>
    </div>
    {daily === null ? <p className="c-muted">График сейчас недоступен. Список заказов ниже работает.</p> : <>
      <div className="c-chart-legend">
        <span><i className="c-bar-delivered" />Доставлено</span><span><i className="c-bar-open" />Не доставлено</span>
      </div>
      <div className="c-bars-wrap">
        <span className="c-axis-max">{peak}</span>
        <div className="c-bars" style={{ gap: days.length > 31 ? 1 : 3 }}>
          {days.map((day, index) => {
            const active = day.date === selected;
            const text = courierChartBarText(day, daily.today);
            return <Link key={day.date} scroll={false} className={active ? 'c-col active' : 'c-col'}
              aria-current={active ? 'date' : undefined} aria-label={text} title={text}
              href={courierOrdersHref({ status, date: day.date, period })}>
              <span className="c-col-plot">
                {day.total > 0 && <span className="c-stack" style={{ height: `${Math.max(3, day.total / peak * 100)}%` }}>
                  {day.undelivered > 0 && <span className="c-bar-open" style={{ flexGrow: day.undelivered }} />}
                  {day.delivered > 0 && <span className="c-bar-delivered" style={{ flexGrow: day.delivered }} />}
                </span>}
              </span>
              <span className="c-col-x">{courierChartLabel(day.date, index, days.length)}</span>
            </Link>;
          })}
        </div>
      </div>
    </>}
  </section>;
}

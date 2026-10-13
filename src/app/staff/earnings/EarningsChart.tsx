'use client';

import { useState } from 'react';
import { money } from '../format';

export type EarningsDay = { date: string; amount: number; orders: number; own: number; site: number };

function dayLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00+05:00`).toLocaleDateString('ru-RU', { timeZone: 'Asia/Dushanbe', ...options });
}

function ordersWord(count: number) {
  const last = count % 10, lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return 'заказ';
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(lastTwo)) return 'заказа';
  return 'заказов';
}

export default function EarningsChart({ days }: { days: EarningsDay[] }) {
  const lastWithData = [...days].reverse().find((day) => day.orders > 0) ?? days[days.length - 1];
  const [selected, setSelected] = useState(lastWithData?.date);
  const max = Math.max(...days.map((day) => day.amount), 1);
  const dense = days.length > 10;
  const current = days.find((day) => day.date === selected) ?? lastWithData;
  const other = current ? Math.max(0, current.orders - current.own - current.site) : 0;

  return <div className="ec">
    <div className="ec-plot" role="group" aria-label="Заработок по дням">
      <span className="ec-max" aria-hidden="true">{money(max)}</span>
      <div className="ec-bars">
        {days.map((day, index) => {
          const active = day.date === current?.date;
          const showLabel = !dense || index % 5 === (days.length - 1) % 5;
          return <button key={day.date} type="button" className={active ? 'ec-col active' : 'ec-col'}
            aria-pressed={active} onClick={() => setSelected(day.date)}
            aria-label={`${dayLabel(day.date, { day: 'numeric', month: 'long' })}: ${money(day.amount)}, ${day.orders} ${ordersWord(day.orders)}`}>
            <span className="ec-bar-area">
              {day.amount > 0 && <span className="ec-bar" style={{ height: `${Math.max(4, (day.amount / max) * 100)}%` }} />}
            </span>
            <span className="ec-x" aria-hidden="true">{showLabel ? dense ? dayLabel(day.date, { day: 'numeric' })
              : dayLabel(day.date, { weekday: 'short' }) : ''}</span>
          </button>;
        })}
      </div>
    </div>
    {current && <div className="ec-detail" aria-live="polite">
      <p className="ec-date">{dayLabel(current.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div className="ec-stats">
        <span><small>Заработал</small><strong>{money(current.amount)}</strong></span>
        <span><small>Доставил</small><strong>{current.orders} {ordersWord(current.orders)}</strong></span>
      </div>
      {current.orders > 0 ? <ul className="ec-split">
        <li><i className="ec-dot ec-dot-own" aria-hidden="true" />Создал сам<b>{current.own}</b></li>
        <li><i className="ec-dot ec-dot-site" aria-hidden="true" />С сайта<b>{current.site}</b></li>
        {other > 0 && <li><i className="ec-dot" aria-hidden="true" />Другие<b>{other}</b></li>}
      </ul> : <p className="c-muted">В этот день доставок не было.</p>}
    </div>}
  </div>;
}

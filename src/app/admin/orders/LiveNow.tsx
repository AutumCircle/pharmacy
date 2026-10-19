'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OrdersInsights } from '@/lib/api-v1/admin-types';
import { minutesAgo, money, origin } from './ui';

export default function LiveNow({ live, renderedAt }: { live: OrdersInsights['live']; renderedAt: number }) {
  const router = useRouter();
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    const refresh = window.setInterval(() => { router.refresh(); setNow(Date.now()); }, 30_000);
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, [router]);

  const waiting = live.pending;
  return <section className={waiting ? 'ao-live ao-live-alert' : 'ao-live'} aria-live="polite">
    <div className="ao-live-head">
      <div>
        <span className="ao-eyebrow">Сейчас</span>
        <h2>{waiting ? `${waiting} ${waiting === 1 ? 'новый заказ ждёт' : 'новых заказа ждут'}` : 'Новых заказов нет'}</h2>
      </div>
      <div className="ao-live-chips">
        <Link href="/admin/orders?view=work&status=pending" className="ao-chip ao-chip-new"><b>{live.pending}</b> новых</Link>
        <Link href="/admin/orders?view=work&status=confirmed" className="ao-chip"><b>{live.confirmed}</b> собираются</Link>
        <Link href="/admin/orders?view=work&status=delivering" className="ao-chip"><b>{live.delivering}</b> в пути</Link>
      </div>
    </div>
    {live.new_orders.length > 0 && <ul className="ao-new-list">
      {live.new_orders.map((order) => {
        const from = origin(order.created_by_staff_account_id);
        return <li key={order.order_id}>
          <Link href={`/admin/orders/${encodeURIComponent(order.order_id)}`} className="ao-new-card">
            <span className="ao-new-top"><strong>№ {order.order_reference || order.order_id.slice(-6)}</strong>
              <span className={`ao-origin ao-origin-${from.key}`}>{from.label}</span></span>
            <span className="ao-new-who">{order.customer_name || 'Без имени'} · {order.phone}</span>
            <span className="ao-new-where">{order.address}</span>
            <span className="ao-new-bottom"><small>{minutesAgo(order.created_at, now)}</small><b>{money(order.order_total)}</b></span>
          </Link>
        </li>;
      })}
    </ul>}
  </section>;
}

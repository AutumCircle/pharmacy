import type { ReactNode } from 'react';
import type { PharmacyPreparationOrder } from '@/lib/api-v1/staff-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { pharmacyOrderView } from '@/lib/pharmacy-order';
import { money, quantityLabel } from '../format';
import WaitingMinutes from './WaitingMinutes';

const statusText = { pending: 'Новый', confirmed: 'Собирается' } as const;

function safeDateTime(value: string): string | null {
  try {
    return formatOrderDateTime(value);
  } catch {
    return null;
  }
}

/**
 * Pharmacy order card. Renders only allowlisted fields (see pharmacyOrderView): never the client's
 * name, phone, address, landmark, client total, profit or creator. `actions` is the reserved footer
 * slot for pharmacist actions (next job).
 */
export default function PharmacyOrderCard({ order, now, actions }: {
  order: PharmacyPreparationOrder; now: number; actions?: ReactNode;
}) {
  const view = pharmacyOrderView(order);
  const createdAt = view.createdAt ? safeDateTime(view.createdAt) : null;
  const priceColumns = view.showPrices;
  return <article className="courier-order-card pharmacy-order-card">
    <header className="pharmacy-order-head">
      <div>
        <h2>Заказ <span className="pharmacy-order-number">{view.reference}</span></h2>
        {createdAt && <time dateTime={view.createdAt ?? undefined}>{createdAt}</time>}
      </div>
      {view.status && <span className={`pharmacy-order-status ${view.status}`}>{statusText[view.status]}</span>}
    </header>
    {view.waitingSince && <WaitingMinutes since={view.waitingSince} initialNow={now} />}
    {view.source && <p className="pharmacy-order-meta">Источник: {view.source}</p>}
    {view.medicines ? <div className="pharmacy-items-scroll">
      <table className="pharmacy-items">
        <thead><tr>
          <th scope="col">Лекарство</th>
          <th scope="col" className="num">Кол-во</th>
          {priceColumns && <th scope="col" className="num">Цена</th>}
          {priceColumns && <th scope="col" className="num">Сумма</th>}
        </tr></thead>
        <tbody>{view.medicines.map((item, index) => <tr key={`${item.name}-${index}`}>
          <td className="name">{item.name}</td>
          <td className="num qty">{item.quantity != null ? quantityLabel(item.quantity) : '—'}</td>
          {priceColumns && <td className="num">{money(item.unitPrice)}</td>}
          {priceColumns && <td className="num">{money(item.lineTotal)}</td>}
        </tr>)}</tbody>
        {view.total != null && <tfoot><tr>
          <th scope="row" colSpan={priceColumns ? 3 : 1}>Итого</th>
          <td className="num total">{money(view.total)}</td>
        </tr></tfoot>}
      </table>
    </div> : <p className="pharmacy-order-meta">Состав заказа скрыт настройками.</p>}
    {view.notes && <p className="pharmacy-order-note">Комментарий: {view.notes}</p>}
    <footer className="pharmacy-order-actions" data-slot="actions">{actions}</footer>
  </article>;
}

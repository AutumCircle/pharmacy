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
 * Pharmacy order card. Shows what the owner's `pharmacy_web` policy lets the Lambda return
 * (see pharmacyOrderView): client name/phone/address/landmark, client totals, profit and creator
 * appear only when turned ON in the admin notification settings. `actions` is the reserved footer
 * slot for pharmacist actions (next job).
 */
export default function PharmacyOrderCard({ order, now, actions }: {
  order: PharmacyPreparationOrder; now: number; actions?: ReactNode;
}) {
  const view = pharmacyOrderView(order);
  const createdAt = view.createdAt ? safeDateTime(view.createdAt) : null;
  const priceColumns = view.showPrices;
  const clientColumn = view.showClientPrices;
  const hasClient = !!(view.customerName || view.phone || view.address || view.landmark);
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
    {view.creator && <p className="pharmacy-order-meta">Создал: {view.creator}</p>}
    {hasClient && <dl className="pharmacy-order-client">
      {view.customerName && <div><dt>Клиент</dt><dd>{view.customerName}</dd></div>}
      {view.phone && <div><dt>Телефон</dt><dd><a href={`tel:${view.phone.replace(/[^\d+]/g, '')}`}>{view.phone}</a></dd></div>}
      {view.address && <div><dt>Адрес</dt><dd>{view.address}</dd></div>}
      {view.landmark && <div><dt>Ориентир</dt><dd>{view.landmark}</dd></div>}
    </dl>}
    {!view.medicines ? <p className="pharmacy-order-meta">Состав заказа скрыт настройками.</p>
      : view.medicines.length === 0 ? <p className="pharmacy-order-meta">В заказе нет позиций.</p>
      : <div className="pharmacy-items-scroll">
        <table className="pharmacy-items">
          <thead><tr>
            <th scope="col">Лекарство</th>
            <th scope="col" className="num">Кол-во</th>
            {priceColumns && <th scope="col" className="num">Цена</th>}
            {priceColumns && <th scope="col" className="num">Сумма</th>}
            {clientColumn && <th scope="col" className="num">Клиенту</th>}
          </tr></thead>
          <tbody>{view.medicines.map((item, index) => <tr key={`${item.name}-${index}`}>
            <td className="name">{item.name}</td>
            <td className="num qty">{item.quantity != null ? quantityLabel(item.quantity) : '—'}</td>
            {priceColumns && <td className="num">{money(item.unitPrice)}</td>}
            {priceColumns && <td className="num">{money(item.lineTotal)}</td>}
            {clientColumn && <td className="num">{money(item.clientLineTotal)}</td>}
          </tr>)}</tbody>
          {view.total != null && <tfoot><tr>
            <th scope="row" colSpan={priceColumns ? 3 : 1}>Итого</th>
            <td className="num total">{money(view.total)}</td>
            {clientColumn && <td className="num">{view.clientTotal != null ? money(view.clientTotal) : ''}</td>}
          </tr></tfoot>}
        </table>
      </div>}
    {(view.clientTotal != null || view.profit != null) && <p className="pharmacy-order-meta">
      {view.clientTotal != null && <>Клиентская сумма: <strong>{money(view.clientTotal)}</strong></>}
      {view.clientTotal != null && view.profit != null && ' · '}
      {view.profit != null && <>Разница: <strong>{money(view.profit)}</strong></>}
    </p>}
    {view.notes && <p className="pharmacy-order-note">Комментарий: {view.notes}</p>}
    <footer className="pharmacy-order-actions" data-slot="actions">{actions}</footer>
  </article>;
}

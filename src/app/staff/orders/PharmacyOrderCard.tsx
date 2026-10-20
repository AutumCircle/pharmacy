import type { ReactNode } from 'react';
import type { PharmacyPreparationOrder } from '@/lib/api-v1/staff-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { assemblyChip } from '@/lib/pharmacy-assembly';
import { pharmacyOrderView } from '@/lib/pharmacy-order';
import { money } from '../format';
import PharmacyAssemblyButtons from './PharmacyAssemblyButtons';
import PharmacyItemRow from './PharmacyItemRow';
import WaitingMinutes from './WaitingMinutes';

function safeDateTime(value: string): string | null {
  try {
    return formatOrderDateTime(value);
  } catch {
    return null;
  }
}

/**
 * Pharmacy order card, one format for «Ватан 1» and «Ватан 2» (job 014). Shows what the owner's
 * `pharmacy_web` policy lets the Lambda return (see pharmacyOrderView): client name/phone/address/landmark,
 * client totals, profit and creator appear only when turned ON in the admin notification settings.
 * The medicines table (PharmacyItemRow) holds every item of this pharmacy — including the items «Ватан 1»
 * routed to «Ватан 2» — with the compact «В наличии» / «Нет в наличии» next to the sum, the tap-to-edit
 * price and, for routed items, «Собрано». At «Ватан 1» items sent to «Ватан 2» stay in the table,
 * read-only, marked «Ватан 2» (orange) or «Нет в наличии в обеих аптеках» (red). The status chip shows the
 * stage («Собирается» / «Собран» / «Подтверждён»). With an old Lambda response (no order_item_id) no answer
 * column or controls are rendered. «Начать сборку» / «Сборка сделана» (PharmacyAssemblyButtons) stay in
 * the footer while this pharmacy has something to assemble. `actions` overrides the footer.
 */
export default function PharmacyOrderCard({ order, now, actions, pharmacyId }: {
  order: PharmacyPreparationOrder; now: number; actions?: ReactNode; pharmacyId?: number;
}) {
  const view = pharmacyOrderView(order, pharmacyId);
  const createdAt = view.createdAt ? safeDateTime(view.createdAt) : null;
  const columns = { prices: view.showPrices, client: view.showClientPrices, answer: view.answerColumn,
    actions: view.actionColumn };
  const hasClient = !!(view.customerName || view.phone || view.address || view.landmark);
  const chip = assemblyChip(view.assemblyState);
  const assembly = view.partControls ? <PharmacyAssemblyButtons orderId={order.order_id} state={view.assemblyState} />
    : view.assemblyState || view.assemblyAvailable ? <span className="pa-assembly-mark">Сборка: <span
      className={`pa-chip pa-tone-${chip.tone}`}>{chip.text}</span></span>
    : null;
  const footer = actions ?? assembly;
  return <article className="courier-order-card pharmacy-order-card">
    <header className="pharmacy-order-head">
      <div>
        <h2>Заказ <span className="pharmacy-order-number">{view.reference}</span></h2>
        {createdAt && <time dateTime={view.createdAt ?? undefined}>{createdAt}</time>}
      </div>
      {view.status && <span className={`pharmacy-order-status ${view.status}`}>{view.stageLabel}</span>}
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
    {!view.rows ? <p className="pharmacy-order-meta">Состав заказа скрыт настройками.</p>
      : view.rows.length === 0 ? <p className="pharmacy-order-meta">В заказе нет позиций.</p>
      : <div className="pharmacy-items-scroll">
        <table className="pharmacy-items">
          <thead><tr>
            <th scope="col">Лекарство</th>
            <th scope="col" className="num">Кол-во</th>
            {columns.prices && <th scope="col" className="num">Цена</th>}
            {columns.prices && <th scope="col" className="num">Сумма</th>}
            {columns.actions && <th scope="col" className="pa-act"><span className="sr-only">Наличие</span></th>}
            {columns.client && <th scope="col" className="num">Клиенту</th>}
            {columns.answer && <th scope="col">Ответ</th>}
          </tr></thead>
          <tbody>{view.rows.map((row) => <PharmacyItemRow key={row.key} orderId={order.order_id} row={row}
            columns={columns} confirmText={view.unavailableConfirm} />)}</tbody>
          {view.total != null && <tfoot><tr>
            <th scope="row" colSpan={columns.prices ? 3 : 1}>Итого</th>
            <td className="num total">{money(view.total)}</td>
            {columns.actions && <td />}
            {columns.client && <td className="num">{view.clientTotal != null ? money(view.clientTotal) : ''}</td>}
            {columns.answer && <td />}
          </tr></tfoot>}
        </table>
      </div>}
    {(view.clientTotal != null || view.profit != null) && <p className="pharmacy-order-meta">
      {view.clientTotal != null && <>Клиентская сумма: <strong>{money(view.clientTotal)}</strong></>}
      {view.clientTotal != null && view.profit != null && ' · '}
      {view.profit != null && <>Разница: <strong>{money(view.profit)}</strong></>}
    </p>}
    {view.notes && <p className="pharmacy-order-note">Комментарий: {view.notes}</p>}
    <footer className="pharmacy-order-actions" data-slot="actions">{footer}</footer>
  </article>;
}

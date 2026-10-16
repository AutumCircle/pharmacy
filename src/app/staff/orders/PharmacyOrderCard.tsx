import type { ReactNode } from 'react';
import type { PharmacyPreparationOrder } from '@/lib/api-v1/staff-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { pharmacyAnswerChip } from '@/lib/pharmacy-answers';
import { assemblyChip } from '@/lib/pharmacy-assembly';
import { pharmacyOrderView } from '@/lib/pharmacy-order';
import { money, quantityLabel } from '../format';
import PharmacyAnswerForm from './PharmacyAnswerForm';
import PharmacyAssemblyButtons from './PharmacyAssemblyButtons';
import PharmacyRoutedItems from './PharmacyRoutedItems';
import WaitingMinutes from './WaitingMinutes';

// «Согласован» rather than «Собирается»: the assembly itself is shown by this pharmacy's own mark (job 011).
const statusText = { pending: 'Новый', confirmed: 'Согласован' } as const;

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
 * appear only when turned ON in the admin notification settings. Job 010: each item shows this
 * pharmacy's answer chip, and while the order is «Новый» the footer holds PharmacyAnswerForm. With an
 * old Lambda response (no order_item_id) no answer column or controls are rendered.
 * Job 011 + rework 1: while the order is «Новый» (or confirmed) and this pharmacy has something to assemble
 * (`assembly_available`), the footer holds PharmacyAssemblyButtons («Начать сборку» -> «Сборка сделана»).
 * Items routed here from «Ватан 1» get per-item controls (PharmacyRoutedItems: «В наличии» + price,
 * «Нет в наличии», «Собрано»); the 010 answer form covers the other items. Routed items carry the owner's
 * colours (orange «В аптеке 2», red «Нет в наличии в обеих аптеках»). Without the new fields (old Lambda)
 * none of these controls are rendered. `actions` overrides the footer.
 */
export default function PharmacyOrderCard({ order, now, actions, pharmacyId }: {
  order: PharmacyPreparationOrder; now: number; actions?: ReactNode; pharmacyId?: number;
}) {
  const view = pharmacyOrderView(order);
  const createdAt = view.createdAt ? safeDateTime(view.createdAt) : null;
  const priceColumns = view.showPrices;
  const clientColumn = view.showClientPrices;
  const hasClient = !!(view.customerName || view.phone || view.address || view.landmark);
  const answerColumn = view.hasAnswers;
  const routedItems = view.hasAnswers && view.medicines ? view.medicines.filter((item) => item.routedHere) : [];
  const ownItems = view.medicines ? view.medicines.filter((item) => !item.routedHere) : [];
  const chip = assemblyChip(view.assemblyState);
  const assembly = view.partControls ? <PharmacyAssemblyButtons orderId={order.order_id} state={view.assemblyState} />
    : view.assemblyState || view.assemblyAvailable ? <span className="pa-assembly-mark">Сборка: <span
      className={`pa-chip pa-tone-${chip.tone}`}>{chip.text}</span></span>
    : null;
  const footer = actions ?? (assembly || routedItems.length > 0 || (view.canAnswer && ownItems.length > 0) ? <>
    {assembly}
    {routedItems.length > 0 && <PharmacyRoutedItems orderId={order.order_id} canAnswer={view.canAnswer}
      items={routedItems.map((item) => ({ orderItemId: item.orderItemId as number, name: item.name,
        unitPrice: item.unitPrice, myAnswer: item.myAnswer, collected: item.collected, crossMark: item.crossMark }))} />}
    {view.canAnswer && ownItems.length > 0 && <PharmacyAnswerForm orderId={order.order_id} pharmacyId={pharmacyId}
      items={ownItems.map((item) => ({ orderItemId: item.orderItemId as number, name: item.name,
        myAnswer: item.myAnswer, myProblem: item.myProblem }))} />}
  </> : null);
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
            {answerColumn && <th scope="col">Ответ</th>}
          </tr></thead>
          <tbody>{view.medicines.map((item, index) => <tr key={`${item.orderItemId ?? item.name}-${index}`}>
            <td className="name">{item.name}
              {item.myProblem && <small className="pa-item-problem">{item.myProblem}</small>}</td>
            <td className="num qty">{item.quantity != null ? quantityLabel(item.quantity) : '—'}</td>
            {priceColumns && <td className="num">{money(item.unitPrice)}</td>}
            {priceColumns && <td className="num">{money(item.lineTotal)}</td>}
            {clientColumn && <td className="num">{money(item.clientLineTotal)}</td>}
            {answerColumn && <td className="answer"><span className={`pa-chip pa-tone-${(item.crossMark
              ?? pharmacyAnswerChip(item.myAnswer)).tone}`}>{(item.crossMark ?? pharmacyAnswerChip(item.myAnswer)).text}</span>
              {item.collected && <span className="pa-chip pa-tone-ok pa-chip-extra">Собрано</span>}</td>}
          </tr>)}</tbody>
          {view.total != null && <tfoot><tr>
            <th scope="row" colSpan={priceColumns ? 3 : 1}>Итого</th>
            <td className="num total">{money(view.total)}</td>
            {clientColumn && <td className="num">{view.clientTotal != null ? money(view.clientTotal) : ''}</td>}
            {answerColumn && <td />}
          </tr></tfoot>}
        </table>
      </div>}
    {(view.clientTotal != null || view.profit != null) && <p className="pharmacy-order-meta">
      {view.clientTotal != null && <>Клиентская сумма: <strong>{money(view.clientTotal)}</strong></>}
      {view.clientTotal != null && view.profit != null && ' · '}
      {view.profit != null && <>Разница: <strong>{money(view.profit)}</strong></>}
    </p>}
    {view.routedAwayCount > 0 && <div className="pa-routed">
      <p>Передано в Ватан 2: {view.routedAwayCount} поз.</p>
      {view.routedAway.length > 0 && <ul className="pa-routed-list">{view.routedAway.map((entry, index) =>
        <li key={`${entry.name}-${index}`} className={`pa-item-tone-${entry.tone}`}>
          <span className="pa-item-name">{entry.name}{entry.quantity != null && ` · ${quantityLabel(entry.quantity)} шт.`}</span>
          <span className={`pa-chip pa-tone-${entry.tone}`}>{entry.text}</span>
        </li>)}</ul>}
    </div>}
    {view.notes && <p className="pharmacy-order-note">Комментарий: {view.notes}</p>}
    <footer className="pharmacy-order-actions" data-slot="actions">{footer}</footer>
  </article>;
}

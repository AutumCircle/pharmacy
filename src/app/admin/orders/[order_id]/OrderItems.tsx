'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminOrderItem } from '@/lib/api-v1/admin-types';
import type { OrderStatus } from '@/lib/api-v1/types';
import QuantityStepper from '@/app/staff/orders/QuantityStepper';
import { parsePrice, priceInput } from '@/app/staff/format';
import { setOrderItemQuantity, updateOrderItemPrice } from '../actions';
import { money } from '../ui';

function confirmChange(status: OrderStatus) {
  if (status === 'delivered') return window.confirm('Заказ уже доставлен. Его сумма изменится задним числом. Продолжить?');
  if (status === 'cancelled') return window.confirm('Заказ отменён. Изменить его состав для истории? Статус останется отменённым.');
  return true;
}

function ItemRow({ orderId, item, status, meta }: {
  orderId: string; item: AdminOrderItem; status: OrderStatus; meta?: OrderItemMeta;
}) {
  const router = useRouter();
  const initialQuantity = Number(item.quantity);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [selling, setSelling] = useState(priceInput(item.selling_unit_price));
  const [base, setBase] = useState(priceInput(item.base_unit_price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const sellingPrice = parsePrice(selling), basePrice = parsePrice(base);
    if (!sellingPrice || !basePrice) { setError('Цены — положительные числа, например 25 или 12,50'); return; }
    const priceChanged = Number(sellingPrice) !== Number(item.selling_unit_price) || Number(basePrice) !== Number(item.base_unit_price);
    const quantityChanged = quantity !== initialQuantity;
    if (!priceChanged && !quantityChanged) { setOpen(false); return; }
    if (!confirmChange(status)) return;
    setBusy(true); setError('');
    if (quantityChanged) {
      const result = await setOrderItemQuantity(orderId, item.order_item_id, initialQuantity, quantity);
      if (!result.success) { setError(result.error); setBusy(false); return; }
    }
    if (priceChanged) {
      const result = await updateOrderItemPrice(orderId, item.order_item_id,
        { sellingUnitPrice: Number(sellingPrice), baseUnitPrice: Number(basePrice) });
      if (!result.success) { setError(result.error); setBusy(false); router.refresh(); return; }
    }
    setBusy(false); setOpen(false); router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Удалить «${item.medicine_name}» из заказа? В каталоге лекарство останется.`) || !confirmChange(status)) return;
    setBusy(true); setError('');
    const result = await setOrderItemQuantity(orderId, item.order_item_id, initialQuantity, 0);
    if (result.success) router.refresh(); else { setError(result.error); setBusy(false); }
  }

  const profit = (Number(item.selling_unit_price ?? 0) - Number(item.base_unit_price ?? 0)) * Number(item.quantity);
  if (!open) {
    return <tr className="od-row" onClick={() => setOpen(true)}>
      <td className="od-td-name"><strong>{item.medicine_name}</strong>
        <small>{item.medicine_id ? `ID ${item.medicine_id}` : 'не из каталога'} · аптека {money(item.base_unit_price, 2)}</small>
        {meta?.change && <small className="od-change">{meta.change.text} · <time dateTime={meta.change.at}>{meta.change.time}</time></small>}</td>
      <td className="od-td-pharmacy">{meta && <span className="od-pharmacy-name">{meta.pharmacy}</span>}
        {meta?.pharmacyNote && <small>{meta.pharmacyNote}</small>}
        {meta?.answer && <span className={`od-ff-chip od-ff-tone-${meta.answer.tone}`}>{meta.answer.text}</span>}</td>
      <td className="od-td-num od-td-qty">{Number(item.quantity).toLocaleString('ru-RU')}
        <span className="od-td-x"> × {money(item.selling_unit_price, 2)}</span></td>
      <td className="od-td-num od-td-price">{money(item.selling_unit_price, 2)}</td>
      <td className="od-td-num od-td-sum"><b>{money(item.line_total, 2)}</b>
        <small className={profit >= 0 ? 'od-profit' : 'od-loss'}>{profit >= 0 ? '+' : ''}{money(profit, 2)}</small></td>
      <td className="od-td-edit"><button type="button" className="od-item-edit" aria-label={`Изменить ${item.medicine_name}`}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}>✎</button></td>
    </tr>;
  }
  const lineTotal = (Number(parsePrice(selling) ?? 0) * quantity);
  return <tr className="od-row-editor"><td colSpan={6}><div className="od-item-editor">
    <strong>{item.medicine_name}</strong>
    <div className="od-item-fields">
      <label><span>Количество</span><QuantityStepper value={quantity} onChange={setQuantity} disabled={busy} /></label>
      <label><span>Цена аптеки</span><span className="mp-money"><input value={base} inputMode="decimal"
        onChange={(event) => setBase(event.target.value)} disabled={busy} /><span>с.</span></span></label>
      <label><span>Цена клиенту</span><span className="mp-money"><input value={selling} inputMode="decimal"
        onChange={(event) => setSelling(event.target.value)} disabled={busy} /><span>с.</span></span></label>
      <div className="od-item-total"><span>Сумма</span><b>{money(lineTotal, 2)}</b></div>
    </div>
    {error && <p className="od-error" role="alert">{error}</p>}
    <div className="od-actions">
      <button type="button" className="ao-btn ao-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      <button type="button" className="ao-btn ao-btn-ghost" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>
      <button type="button" className="ao-btn ao-btn-danger od-push" disabled={busy} onClick={() => void remove()}>Удалить</button>
    </div>
  </div></td></tr>;
}

/** Job 016: what the items table shows next to an item, computed on the server from `fulfillment`
 * and `timeline` (both optional: staff-created orders and older Lambdas show plain rows). */
export type OrderItemMeta = {
  pharmacy: string;
  pharmacyNote: string | null;
  answer: { text: string; tone: string } | null;
  change: { text: string; at: string; time: string } | null;
};

export default function OrderItems({ orderId, items, status, meta }: {
  orderId: string; items: AdminOrderItem[]; status: OrderStatus; meta?: Record<number, OrderItemMeta>;
}) {
  if (items.length === 0) return <p className="od-empty">Товаров пока нет — добавьте их ниже.</p>;
  return <div className="od-table-wrap"><table className="od-table">
    <caption className="sr-only">Товары заказа</caption>
    <thead><tr><th scope="col">Товар</th><th scope="col">Аптека и ответ</th><th scope="col" className="od-td-num">Кол-во</th>
      <th scope="col" className="od-td-num">Цена клиенту</th><th scope="col" className="od-td-num">Сумма</th>
      <th scope="col"><span className="sr-only">Изменить</span></th></tr></thead>
    <tbody>
      {items.map((item) => <ItemRow key={`${item.order_item_id}-${item.quantity}-${item.selling_unit_price}-${item.base_unit_price}`}
        orderId={orderId} item={item} status={status} meta={meta?.[item.order_item_id]} />)}
    </tbody>
  </table></div>;
}

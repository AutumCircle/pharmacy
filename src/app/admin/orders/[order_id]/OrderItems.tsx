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

function ItemRow({ orderId, item, status }: { orderId: string; item: AdminOrderItem; status: OrderStatus }) {
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
    return <li><button type="button" className="od-item" onClick={() => setOpen(true)} aria-label={`Изменить ${item.medicine_name}`}>
      <span className="od-item-name"><strong>{item.medicine_name}</strong>
        <small>{item.medicine_id ? `ID ${item.medicine_id}` : 'не из каталога'} · аптека {money(item.base_unit_price, 2)}</small></span>
      <span className="od-item-qty">{Number(item.quantity).toLocaleString('ru-RU')} × {money(item.selling_unit_price, 2)}</span>
      <span className="od-item-sum"><b>{money(item.line_total, 2)}</b>
        <small className={profit >= 0 ? 'od-profit' : 'od-loss'}>{profit >= 0 ? '+' : ''}{money(profit, 2)}</small></span>
      <span className="od-item-edit" aria-hidden="true">✎</span>
    </button></li>;
  }
  const lineTotal = (Number(parsePrice(selling) ?? 0) * quantity);
  return <li className="od-item-editor">
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
  </li>;
}

export default function OrderItems({ orderId, items, status }: { orderId: string; items: AdminOrderItem[]; status: OrderStatus }) {
  if (items.length === 0) return <p className="od-empty">Товаров пока нет — добавьте их ниже.</p>;
  return <ul className="od-items">
    {items.map((item) => <ItemRow key={`${item.order_item_id}-${item.quantity}-${item.selling_unit_price}-${item.base_unit_price}`}
      orderId={orderId} item={item} status={status} />)}
  </ul>;
}

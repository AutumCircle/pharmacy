'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PharmacyAnswer } from '@/lib/api-v1/staff-types';
import { PHARMACY_PRICE_ERROR, normalizePharmacyPrice, validatePharmacyAnswersRequest } from '@/lib/pharmacy-answers';
import { validateItemCollectRequest } from '@/lib/pharmacy-assembly';

export type RoutedItem = {
  orderItemId: number;
  name: string;
  /** This pharmacy's (base) unit price when the policy shows it, else null. */
  unitPrice: number | string | null;
  myAnswer: PharmacyAnswer | null;
  collected: boolean;
  crossMark: { text: string; tone: string } | null;
};

type Editing = { id: number; price: string } | null;

/**
 * «Ватан 2» works items routed from «Ватан 1» one by one (job 011 rework 1): «В наличии» (keep or change
 * the pharmacy price, then «Сохранить») or «Нет в наличии», then «Собрано». The browser sends only the
 * item id, the answer and the pharmacy price; Lambda recomputes client prices and totals and moves the
 * pharmacy's part to «Собран» once every item is collected or unavailable.
 */
export default function PharmacyRoutedItems({ orderId, items, canAnswer }: {
  orderId: string; items: RoutedItem[]; canAnswer: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function post(path: string, body: unknown, id: number) {
    setBusy(id); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(orderId)}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error?.message || (response.status === 409 ? 'Состояние изменилось — карточка обновлена.'
          : 'Не удалось сохранить. Повторите попытку.'));
        if ([403, 404, 409].includes(response.status)) router.refresh();
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError('Нет связи. Повторите попытку.');
    } finally {
      setBusy(null);
    }
  }

  function answer(item: RoutedItem, value: PharmacyAnswer, price?: string) {
    const entry: { order_item_id: number; answer: PharmacyAnswer; base_unit_price?: string } =
      { order_item_id: item.orderItemId, answer: value };
    if (price !== undefined) entry.base_unit_price = price;
    const checked = validatePharmacyAnswersRequest({ answers: [entry] });
    if (!checked.ok) { setError(checked.error); return; }
    void post('pharmacy-answers', checked.value, item.orderItemId);
  }

  function saveAvailable(item: RoutedItem) {
    const raw = editing?.price.trim() ?? '';
    if (!raw) { answer(item, 'available'); return; }
    const price = normalizePharmacyPrice(raw);
    if (price === null) { setError(PHARMACY_PRICE_ERROR); return; }
    const current = item.unitPrice != null ? normalizePharmacyPrice(item.unitPrice) : null;
    answer(item, 'available', price === current ? undefined : price);
  }

  function collect(item: RoutedItem) {
    const checked = validateItemCollectRequest({ order_item_id: item.orderItemId });
    if (!checked.ok) { setError(checked.error); return; }
    void post('assembly/items', checked.value, item.orderItemId);
  }

  return <section className="pa-routed-items" aria-label="Позиции из Ватан 1">
    <p className="pa-panel-title">Переданы из Ватан 1</p>
    <ul className="pa-items">{items.map((item) => {
      const isBusy = busy === item.orderItemId;
      const isEditing = editing?.id === item.orderItemId;
      return <li key={item.orderItemId} className={`pa-item pa-item-tone-${item.crossMark?.tone ?? 'none'}`}>
        <span className="pa-item-name">{item.name}</span>
        <div className="pa-item-marks">
          {item.crossMark && <span className={`pa-chip pa-tone-${item.crossMark.tone}`}>{item.crossMark.text}</span>}
          {item.collected && <span className="pa-chip pa-tone-ok">Собрано</span>}
          {!item.crossMark && !item.collected && item.myAnswer === 'price_differs' &&
            <span className="pa-chip pa-tone-warn">Цена отличается</span>}
        </div>
        {isEditing ? <div className="pa-price-edit">
          <label className="pa-problem">
            <span>Цена аптеки за 1 шт., сом (оставьте как есть или измените)</span>
            <input inputMode="decimal" autoComplete="off" value={editing.price} disabled={isBusy} maxLength={10}
              placeholder={item.unitPrice != null ? String(item.unitPrice) : 'Цена без изменений'}
              onChange={(event) => setEditing({ id: item.orderItemId, price: event.target.value })} />
          </label>
          <div className="pa-actions">
            <button type="button" className="pa-btn pa-btn-ok" disabled={isBusy} onClick={() => saveAvailable(item)}>
              {isBusy ? 'Сохраняем…' : 'Сохранить'}</button>
            <button type="button" className="pa-btn pa-btn-ghost" disabled={isBusy} onClick={() => setEditing(null)}>Отмена</button>
          </div>
        </div>
          : !item.collected && <div className="pa-actions">
            {item.myAnswer === 'available' && <button type="button" className="pa-btn pa-btn-ok" disabled={isBusy}
              onClick={() => collect(item)}>{isBusy ? 'Сохраняем…' : 'Собрано'}</button>}
            {canAnswer && item.myAnswer !== 'unavailable' && <button type="button"
              className={`pa-btn ${item.myAnswer === 'available' ? 'pa-btn-ghost' : 'pa-btn-start'}`} disabled={isBusy}
              onClick={() => { setError(''); setEditing({ id: item.orderItemId,
                price: item.unitPrice != null ? String(item.unitPrice) : '' }); }}>
              {item.myAnswer === 'available' ? 'Изменить цену' : 'В наличии'}</button>}
            {canAnswer && item.myAnswer !== 'available' && item.myAnswer !== 'unavailable' && <button type="button"
              className="pa-btn pa-btn-problem" disabled={isBusy} onClick={() => answer(item, 'unavailable')}>
              Нет в наличии</button>}
          </div>}
      </li>;
    })}</ul>
    {error && <p className="pa-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
  </section>;
}

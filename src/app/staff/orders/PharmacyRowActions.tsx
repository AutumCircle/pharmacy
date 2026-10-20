'use client';

import { useState } from 'react';
import type { PharmacyAnswer } from '@/lib/api-v1/staff-types';
import { ROW_ACTION_LABELS, rowActionRequest, type RowAction } from '@/lib/pharmacy-answers';
import { usePharmacyItemPost } from './usePharmacyItemPost';

/**
 * Job 013: controls of one own row in the pharmacy medicines table while the order is pending:
 * «В наличии», «Нет в наличии» (from «Ватан 1» the item goes to «Ватан 2» and stays in the table
 * marked «Ватан 2») and «Изменить цену» → «Сохранить» (the pharmacy (base) price, sent with «В наличии»).
 * The browser sends only the item id, the answer and the price; Lambda recomputes client prices and totals.
 */
export default function PharmacyRowActions({ orderId, orderItemId, name, unitPrice, myAnswer, pharmacyId }: {
  orderId: string; orderItemId: number; name: string; unitPrice: number | string | null;
  myAnswer: PharmacyAnswer | null; pharmacyId?: number;
}) {
  const { busy, error, setError, errorRef, post } = usePharmacyItemPost(orderId);
  const [editing, setEditing] = useState<string | null>(null);
  // «Нет в наличии» cannot be undone from «Ватан 1» (the item moves to «Ватан 2» and Telegram is sent):
  // ask once inline to avoid a mis-tap next to «В наличии».
  const [confirming, setConfirming] = useState(false);
  const isBusy = busy === orderItemId;

  async function send(action: RowAction, price?: string) {
    const checked = rowActionRequest(orderItemId, action, price, unitPrice);
    if (!checked.ok) { setError(checked.error); return; }
    if (await post('pharmacy-answers', checked.value, orderItemId)) { setEditing(null); setConfirming(false); }
  }

  return <div className="pa-row-controls">
    {editing !== null ? <div className="pa-price-edit">
      <label className="pa-problem">
        <span>Цена аптеки за 1 шт., сом: {name}</span>
        <input inputMode="decimal" autoComplete="off" value={editing} disabled={isBusy} maxLength={10} autoFocus
          placeholder={unitPrice != null ? String(unitPrice) : 'Цена без изменений'}
          onChange={(event) => setEditing(event.target.value)} />
      </label>
      <div className="pa-actions">
        <button type="button" className="pa-btn pa-btn-ok" disabled={isBusy} onClick={() => void send('price', editing)}>
          {isBusy ? 'Сохраняем…' : ROW_ACTION_LABELS.save}</button>
        <button type="button" className="pa-btn pa-btn-ghost" disabled={isBusy}
          onClick={() => { setEditing(null); setError(''); }}>Отмена</button>
      </div>
    </div> : confirming ? <div className="pa-actions" role="group" aria-label={`Подтверждение: ${name}`}>
      <p className="pa-row-confirm">{pharmacyId === 1 ? 'Передать в Ватан 2?' : 'Отметить «Нет в наличии»?'}</p>
      <button type="button" className="pa-btn pa-btn-problem" disabled={isBusy} autoFocus
        onClick={() => void send('unavailable')}>{isBusy ? 'Сохраняем…' : 'Да'}</button>
      <button type="button" className="pa-btn pa-btn-ghost" disabled={isBusy}
        onClick={() => setConfirming(false)}>Отмена</button>
    </div> : <div className="pa-actions" role="group" aria-label={`Ответ: ${name}`}>
      <button type="button" className={`pa-btn pa-btn-ok${myAnswer === 'available' ? ' selected' : ''}`}
        aria-pressed={myAnswer === 'available'} disabled={isBusy || myAnswer === 'available'}
        onClick={() => void send('available')}>{isBusy ? 'Сохраняем…' : ROW_ACTION_LABELS.available}</button>
      <button type="button" className={`pa-btn pa-btn-problem${myAnswer === 'unavailable' ? ' selected' : ''}`}
        aria-pressed={myAnswer === 'unavailable'} disabled={isBusy || myAnswer === 'unavailable'}
        title={pharmacyId === 1 ? 'Позиция уйдёт в «Ватан 2»' : undefined}
        onClick={() => { setError(''); setConfirming(true); }}>{ROW_ACTION_LABELS.unavailable}</button>
      <button type="button" className="pa-btn pa-btn-ghost" disabled={isBusy}
        onClick={() => { setError(''); setEditing(unitPrice != null ? String(unitPrice) : ''); }}>
        {ROW_ACTION_LABELS.price}</button>
    </div>}
    {error && <p className="pa-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
  </div>;
}

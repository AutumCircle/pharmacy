'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { ROW_ACTION_LABELS, rowActionRequest, type RowAction } from '@/lib/pharmacy-answers';
import { validateItemCollectRequest } from '@/lib/pharmacy-assembly';
import type { PharmacyTableRow } from '@/lib/pharmacy-order';
import { money, quantityLabel } from '../format';
import { usePharmacyItemPost } from './usePharmacyItemPost';

export type PharmacyTableColumns = { prices: boolean; client: boolean; answer: boolean; actions: boolean };

/**
 * Job 014: one row of the pharmacy medicines table, the same for «Ватан 1» and «Ватан 2».
 * Own rows of a «Новый» order carry small «В наличии» / «Нет в наличии» buttons right next to the line sum
 * («Нет в наличии» asks once inline: «Ватан 1» passes the item to «Ватан 2», at «Ватан 2» it is missing in
 * both pharmacies). Tapping the price turns it into an input: Enter or «✓» saves the pharmacy (base) price
 * as «В наличии», Esc or «×» cancels. Items routed to «Ватан 2» also get «Собрано». Routed-away rows of
 * «Ватан 1» are read-only. The browser sends only the item id, the answer and the price; the Lambda
 * recomputes client prices and totals.
 */
export default function PharmacyItemRow({ orderId, row, columns, confirmText }: {
  orderId: string; row: PharmacyTableRow; columns: PharmacyTableColumns; confirmText: string;
}) {
  const { busy, error, setError, errorRef, post } = usePharmacyItemPost(orderId);
  const [price, setPrice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const id = row.orderItemId;
  const isBusy = id !== null && busy === id;
  const routed = row.kind === 'routed';

  async function send(action: RowAction, value?: string) {
    if (id === null) return;
    const checked = rowActionRequest(id, action, value, row.unitPrice);
    if (!checked.ok) { setError(checked.error); return; }
    if (await post('pharmacy-answers', checked.value, id)) { setPrice(null); setConfirming(false); }
  }

  function savePrice(event: FormEvent) {
    event.preventDefault();
    void send('price', price ?? '');
  }

  function priceKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); setPrice(null); setError(''); }
  }

  function collect() {
    if (id === null) return;
    const checked = validateItemCollectRequest({ order_item_id: id });
    if (!checked.ok) { setError(checked.error); return; }
    void post('assembly/items', checked.value, id);
  }

  const priceCell = row.canEditPrice && id !== null
    ? price !== null
      ? <form className="pa-price-inline" onSubmit={savePrice}>
        <input inputMode="decimal" autoComplete="off" value={price} disabled={isBusy} maxLength={10} autoFocus
          aria-label={`Цена аптеки за 1 шт., сом: ${row.name}`} onKeyDown={priceKey}
          onChange={(event) => setPrice(event.target.value)} />
        <button type="submit" className="pa-mini pa-mini-ok" disabled={isBusy}
          aria-label={ROW_ACTION_LABELS.save} title={ROW_ACTION_LABELS.save}>{isBusy ? '…' : '✓'}</button>
        <button type="button" className="pa-mini" disabled={isBusy} aria-label={ROW_ACTION_LABELS.cancel}
          title={ROW_ACTION_LABELS.cancel} onClick={() => { setPrice(null); setError(''); }}>×</button>
      </form>
      : <button type="button" className="pa-price-tap" disabled={isBusy}
        aria-label={`${ROW_ACTION_LABELS.price}: ${row.name}, ${money(row.unitPrice)}`} title={ROW_ACTION_LABELS.price}
        onClick={() => { setError(''); setConfirming(false); setPrice(row.unitPrice != null ? String(row.unitPrice) : ''); }}>
        {money(row.unitPrice)}</button>
    : routed ? '—' : money(row.unitPrice);

  const controls = id === null ? null : confirming
    ? <div className="pa-mini-group" role="group" aria-label={`Подтверждение: ${row.name}`}>
      <span className="pa-row-confirm">{confirmText}</span>
      <button type="button" className="pa-mini pa-mini-bad" disabled={isBusy} autoFocus
        onClick={() => void send('unavailable')}>{isBusy ? '…' : ROW_ACTION_LABELS.confirm}</button>
      <button type="button" className="pa-mini" disabled={isBusy}
        onClick={() => setConfirming(false)}>{ROW_ACTION_LABELS.cancel}</button>
    </div>
    : (row.canAct || row.canCollect) && <div className="pa-mini-group" role="group" aria-label={`Ответ: ${row.name}`}>
      {row.canAct && <>
        <button type="button" className={`pa-mini pa-mini-ok${row.myAnswer === 'available' ? ' selected' : ''}`}
          aria-pressed={row.myAnswer === 'available'} disabled={isBusy || row.myAnswer === 'available'}
          onClick={() => void send('available')}>{ROW_ACTION_LABELS.available}</button>
        <button type="button" className={`pa-mini pa-mini-bad${row.myAnswer === 'unavailable' ? ' selected' : ''}`}
          aria-pressed={row.myAnswer === 'unavailable'} disabled={isBusy || row.myAnswer === 'unavailable'}
          onClick={() => { setError(''); setPrice(null); setConfirming(true); }}>{ROW_ACTION_LABELS.unavailable}</button>
      </>}
      {row.canCollect && <button type="button" className="pa-mini pa-mini-ok" disabled={isBusy}
        onClick={collect}>{isBusy ? '…' : ROW_ACTION_LABELS.collect}</button>}
    </div>;

  return <tr className={routed ? `pa-row-routed pa-item-tone-${row.chip?.tone ?? 'orange'}` : undefined} aria-busy={isBusy}>
    <td className="name">{row.name}
      {row.myProblem && <small className="pa-item-problem">{row.myProblem}</small>}
      {row.hint && <small className="pa-routed-hint">{row.hint}</small>}
      {error && <p className="pa-error pa-row-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}</td>
    <td className="num qty">{row.quantity != null ? quantityLabel(row.quantity) : '—'}</td>
    {columns.prices && <td className="num price">{priceCell}</td>}
    {columns.prices && <td className="num">{routed ? '—' : money(row.lineTotal)}</td>}
    {columns.actions && <td className="pa-act">{controls}</td>}
    {columns.client && <td className="num">{routed ? '—' : money(row.clientLineTotal)}</td>}
    {columns.answer && <td className="answer">{row.chip && <span className={`pa-chip pa-tone-${row.chip.tone}`}>
      {row.chip.text}</span>}
      {row.collected && <span className="pa-chip pa-tone-ok pa-chip-extra">Собрано</span>}</td>}
  </tr>;
}

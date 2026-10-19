'use client';

import { useEffect, useState } from 'react';
import type { StaffOrderMedicine } from '@/lib/api-v1/staff-types';
import { money, parsePrice, priceInput } from '../format';
import QuantityStepper from './QuantityStepper';
import './picker.css';

export type PickerLine = {
  key: string;
  medicine_id: number | null;
  medicine_name: string;
  quantity: number;
  price: string;
};

type Props = {
  lines: PickerLine[];
  onChange: (lines: PickerLine[]) => void;
  /** Client price suggested for a catalogue medicine; the courier can still change it. */
  defaultPrice: (medicine: StaffOrderMedicine) => number | string;
  /** Catalogue search; defaults to the courier API. The admin passes a server action. */
  search?: (query: string, signal: AbortSignal) => Promise<StaffOrderMedicine[]>;
};

async function staffSearch(query: string, signal: AbortSignal): Promise<StaffOrderMedicine[]> {
  const response = await fetch(`/api/staff/order-medicines?q=${encodeURIComponent(query)}`, { cache: 'no-store', signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'search failed');
  return result.data || [];
}

export function lineTotal(lines: PickerLine[]): number {
  return lines.reduce((sum, line) => sum + (Number(parsePrice(line.price) ?? 0) * line.quantity), 0);
}

export function invalidLine(lines: PickerLine[]): PickerLine | undefined {
  return lines.find((line) => parsePrice(line.price) === null);
}

function ManualForm({ initialName, onSave, onCancel }: {
  initialName: string; onSave: (name: string, price: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  function save() {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    const cleanPrice = parsePrice(price);
    if (cleanName.length < 2) { setError('Название — минимум 2 буквы'); return; }
    if (!cleanPrice) { setError('Укажите цену, например 25 или 12,50'); return; }
    onSave(cleanName.slice(0, 200), cleanPrice);
  }

  return <div className="mp-manual-form">
    <strong>Товар не из каталога</strong>
    <label>Название<input value={name} maxLength={200} autoFocus onChange={(event) => setName(event.target.value)} /></label>
    <label>Цена за 1 шт.<div className="mp-money"><input value={price} inputMode="decimal" placeholder="0"
      onChange={(event) => setPrice(event.target.value)} /><span>с.</span></div></label>
    {error && <p className="c-error" role="alert">{error}</p>}
    <div className="c-row-actions">
      <button type="button" className="c-btn c-btn-primary" onClick={save}>Сохранить</button>
      <button type="button" className="c-btn c-btn-ghost" onClick={onCancel}>Отмена</button>
    </div>
  </div>;
}

export default function MedicinePicker({ lines, onChange, defaultPrice, search = staffSearch }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffOrderMedicine[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState('loading');
      try {
        const found = await search(text, controller.signal);
        if (controller.signal.aborted) return;
        setResults(found);
        setState('done');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, search]);

  function addCatalog(medicine: StaffOrderMedicine) {
    if (lines.some((line) => line.medicine_id === medicine.medicine_id)) return;
    onChange([...lines, { key: `m${medicine.medicine_id}`, medicine_id: medicine.medicine_id,
      medicine_name: medicine.medicine_name, quantity: 1, price: priceInput(defaultPrice(medicine)) }]);
    setQuery('');
  }

  function addManual(name: string, price: string) {
    onChange([...lines, { key: `x${Date.now()}`, medicine_id: null, medicine_name: name, quantity: 1, price }]);
    setManualOpen(false); setQuery('');
  }

  function update(key: string, patch: Partial<PickerLine>) {
    onChange(lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  const searching = query.trim().length >= 2;
  const nothingFound = searching && state === 'done' && results.length === 0;

  return <div className="mp">
    {!manualOpen && <label className="mp-search">
      <span className="sr-only">Поиск лекарства</span>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" /></svg>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название лекарства"
        autoComplete="off" enterKeyHint="search" />
      {query && <button type="button" className="mp-clear" aria-label="Очистить поиск" onClick={() => setQuery('')}>×</button>}
    </label>}

    {searching && !manualOpen && <div className="mp-results" aria-live="polite">
      {state === 'loading' && <p className="mp-hint">Ищем…</p>}
      {state === 'error' && <p className="mp-hint mp-hint-error">Поиск не сработал. Проверьте интернет.</p>}
      {nothingFound && <div className="mp-nothing">
        <p>«{query.trim()}» нет в каталоге</p>
        <button type="button" className="c-btn c-btn-outline c-btn-wide" onClick={() => setManualOpen(true)}>
          + Добавить товар, которого нет в каталоге</button>
      </div>}
      {state !== 'loading' && results.map((medicine) => {
        const added = lines.some((line) => line.medicine_id === medicine.medicine_id);
        return <div key={medicine.medicine_id} className="mp-result">
          <span className="mp-result-name"><strong>{medicine.medicine_name}</strong>
            <small>{money(defaultPrice(medicine))}{medicine.vendor ? ` · ${medicine.vendor}` : ''}</small>
          </span>
          <button type="button" className={added ? 'mp-add mp-add-on' : 'mp-add'} disabled={added}
            onClick={() => addCatalog(medicine)}>{added ? 'В заказе ✓' : 'Добавить'}</button>
        </div>;
      })}
    </div>}

    {manualOpen && <ManualForm initialName={query.trim()} onSave={addManual} onCancel={() => setManualOpen(false)} />}

    {lines.length > 0 && <ul className="mp-lines">
      {lines.map((line) => {
        const valid = parsePrice(line.price) !== null;
        return <li key={line.key} className="mp-line">
          <div className="mp-line-head">
            <span className="mp-line-name"><strong>{line.medicine_name}</strong>
              {line.medicine_id === null && <span className="mp-tag">не из каталога</span>}</span>
            <button type="button" className="mp-remove" aria-label={`Убрать ${line.medicine_name}`}
              onClick={() => onChange(lines.filter((entry) => entry.key !== line.key))}>×</button>
          </div>
          <div className="mp-line-body">
            <QuantityStepper value={line.quantity} onChange={(quantity) => update(line.key, { quantity })} />
            <label className={valid ? 'mp-money' : 'mp-money mp-money-invalid'}>
              <span className="sr-only">Цена за 1 шт.</span>
              <input value={line.price} inputMode="decimal" placeholder="Цена"
                onChange={(event) => update(line.key, { price: event.target.value })} />
              <span aria-hidden="true">с.</span>
            </label>
            <span className="mp-line-total">{valid ? money(Number(parsePrice(line.price)) * line.quantity) : '—'}</span>
          </div>
        </li>;
      })}
    </ul>}
  </div>;
}

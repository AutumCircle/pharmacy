'use client';

import { useEffect, useRef, useState } from 'react';
import type { StaffOrderMedicine } from '@/lib/api-v1/staff-types';
import { money, parsePrice, priceInput, quantityLabel } from '../format';

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
};

export function lineTotal(lines: PickerLine[]): number {
  return lines.reduce((sum, line) => sum + (Number(parsePrice(line.price) ?? 0) * line.quantity), 0);
}

export function invalidLine(lines: PickerLine[]): PickerLine | undefined {
  return lines.find((line) => parsePrice(line.price) === null);
}

function stepDown(quantity: number) { return quantity > 1 ? quantity - 1 : 0.5; }
function stepUp(quantity: number) { return quantity < 1 ? 1 : Math.min(99, quantity + 1); }

export default function MedicinePicker({ lines, onChange, defaultPrice }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffOrderMedicine[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  const focusKey = useRef<string | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState('loading');
      try {
        const response = await fetch(`/api/staff/order-medicines?q=${encodeURIComponent(text)}`,
          { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error();
        setResults(result.data || []);
        setState('done');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    if (!focusKey.current) return;
    priceRefs.current.get(focusKey.current)?.focus();
    focusKey.current = null;
  }, [lines]);

  function addCatalog(medicine: StaffOrderMedicine) {
    const existing = lines.find((line) => line.medicine_id === medicine.medicine_id);
    if (existing) {
      onChange(lines.map((line) => line === existing ? { ...line, quantity: stepUp(line.quantity) } : line));
      return;
    }
    onChange([...lines, { key: `m${medicine.medicine_id}`, medicine_id: medicine.medicine_id,
      medicine_name: medicine.medicine_name, quantity: 1, price: priceInput(defaultPrice(medicine)) }]);
  }

  function addManual() {
    const name = query.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return;
    const key = `x${Date.now()}`;
    focusKey.current = key;
    onChange([...lines, { key, medicine_id: null, medicine_name: name.slice(0, 200), quantity: 1, price: '' }]);
    setQuery('');
  }

  function update(key: string, patch: Partial<PickerLine>) {
    onChange(lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  const total = lineTotal(lines);
  const showResults = query.trim().length >= 2;

  return <div className="mp">
    <label className="mp-search">
      <span className="sr-only">Поиск лекарства</span>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" /></svg>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти лекарство по названию"
        autoComplete="off" enterKeyHint="search" />
      {query && <button type="button" className="mp-clear" aria-label="Очистить поиск" onClick={() => setQuery('')}>×</button>}
    </label>

    {showResults && <div className="mp-results" aria-live="polite">
      {state === 'loading' && results.length === 0 && <p className="mp-hint">Ищем…</p>}
      {state === 'error' && <p className="mp-hint mp-hint-error">Поиск не сработал. Проверьте интернет.</p>}
      {state === 'done' && results.length === 0 && <p className="mp-hint">В каталоге ничего не найдено.</p>}
      {results.map((medicine) => {
        const added = lines.find((line) => line.medicine_id === medicine.medicine_id);
        return <button type="button" key={medicine.medicine_id} className="mp-result" onClick={() => addCatalog(medicine)}>
          <span className="mp-result-name"><strong>{medicine.medicine_name}</strong>
            {(medicine.vendor || medicine.country) && <small>{[medicine.vendor, medicine.country].filter(Boolean).join(' · ')}</small>}
          </span>
          <span className="mp-result-price">{money(defaultPrice(medicine))}</span>
          <span className={added ? 'mp-add mp-add-on' : 'mp-add'} aria-hidden="true">{added ? quantityLabel(added.quantity) : '+'}</span>
        </button>;
      })}
      {state !== 'loading' && <button type="button" className="mp-manual" onClick={addManual}>
        Нет в каталоге? Добавить «{query.trim().slice(0, 60)}» со своей ценой
      </button>}
    </div>}

    {lines.length > 0 && <ul className="mp-lines">
      {lines.map((line) => {
        const valid = parsePrice(line.price) !== null;
        return <li key={line.key} className="mp-line">
          <div className="mp-line-head">
            <strong>{line.medicine_name}</strong>
            {line.medicine_id === null && <span className="mp-tag">вне каталога</span>}
            <button type="button" className="mp-remove" aria-label={`Убрать ${line.medicine_name}`}
              onClick={() => onChange(lines.filter((entry) => entry.key !== line.key))}>×</button>
          </div>
          <div className="mp-line-body">
            <div className="mp-stepper" role="group" aria-label="Количество">
              <button type="button" aria-label="Меньше" disabled={line.quantity <= 0.5}
                onClick={() => update(line.key, { quantity: stepDown(line.quantity) })}>−</button>
              <output>{quantityLabel(line.quantity)}</output>
              <button type="button" aria-label="Больше" disabled={line.quantity >= 99}
                onClick={() => update(line.key, { quantity: stepUp(line.quantity) })}>+</button>
            </div>
            <span className="mp-times" aria-hidden="true">×</span>
            <label className={valid ? 'mp-price' : 'mp-price mp-price-invalid'}>
              <span className="sr-only">Цена для клиента за 1 шт.</span>
              <input ref={(node) => { if (node) priceRefs.current.set(line.key, node); else priceRefs.current.delete(line.key); }}
                value={line.price} inputMode="decimal" placeholder="Цена"
                onChange={(event) => update(line.key, { price: event.target.value })} />
              <span aria-hidden="true">с.</span>
            </label>
            <span className="mp-line-total">{valid ? money(Number(parsePrice(line.price)) * line.quantity) : '—'}</span>
          </div>
        </li>;
      })}
    </ul>}
    {lines.length > 0 && <div className="mp-total"><span>Сумма товаров</span><strong>{money(total)}</strong></div>}
  </div>;
}

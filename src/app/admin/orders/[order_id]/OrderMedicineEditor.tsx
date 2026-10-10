'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StaffOrderMedicine } from '@/lib/api-v1/staff-types';
import { addOrderMedicines, searchOrderMedicines } from '../actions';

export default function OrderMedicineEditor({ orderId, delivered }: { orderId: string; delivered: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffOrderMedicine[]>([]);
  const [selected, setSelected] = useState<Array<StaffOrderMedicine & { quantity: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestKey = useRef<string | null>(null);

  async function search() {
    setBusy(true); setError('');
    const result = await searchOrderMedicines(query);
    if (result.success) setResults(result.medicines);
    else setError(result.error);
    setBusy(false);
  }

  async function save() {
    if (!selected.length) return;
    if (delivered && !window.confirm('Лекарства добавятся в доставленный заказ. Сумма заказа изменится задним числом, плата за доставку не изменится. Продолжить?')) return;
    setBusy(true); setError(''); setMessage('');
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    const result = await addOrderMedicines(orderId,
      selected.map((item) => ({ medicine_id: item.medicine_id, quantity: item.quantity })), requestKey.current);
    if (result.success) {
      setMessage(`Сохранено: новых ${result.added}, увеличено количество у ${result.increased}.`);
      setSelected([]); setResults([]); setQuery(''); requestKey.current = null;
      router.refresh();
    } else setError(result.error);
    setBusy(false);
  }

  return <section style={{ background: 'white', padding: 20, borderRadius: 12, marginTop: 16 }}>
    <h3 style={{ marginTop: 0 }}>Добавить лекарства{delivered ? ' в доставленный заказ' : ''}</h3>
    <p style={{ color: '#667085' }}>Доступен каталог аптеки 1. Стоимость доставки не меняется.</p>
    <div className="staff-search"><input aria-label="Название лекарства" value={query}
      onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }}
      placeholder="Название лекарства" />
      <button type="button" disabled={busy || query.trim().length < 2} onClick={search}>Найти</button></div>
    {results.length > 0 && <div className="staff-picker-results">{results.map((medicine) => <div key={medicine.medicine_id}>
      <span><strong>{medicine.medicine_name}</strong><small>Цена аптеки {Number(medicine.base_unit_price).toFixed(2)} с.</small></span>
      <button type="button" disabled={selected.length >= 20 || selected.some((item) => item.medicine_id === medicine.medicine_id)}
        onClick={() => { setSelected((items) => [...items, { ...medicine, quantity: 1 }]); requestKey.current = null; }}>Выбрать</button>
    </div>)}</div>}
    {selected.length > 0 && <div className="staff-selected-items">{selected.map((item) => <div key={item.medicine_id}>
      <span><strong>{item.medicine_name}</strong></span>
      <input type="number" aria-label={`Количество: ${item.medicine_name}`} min={1} max={99} value={item.quantity}
        onChange={(event) => { const quantity = Math.min(99, Math.max(1, Number(event.target.value) || 1));
          setSelected((items) => items.map((entry) => entry.medicine_id === item.medicine_id ? { ...entry, quantity } : entry)); requestKey.current = null; }} />
      <button type="button" onClick={() => { setSelected((items) => items.filter((entry) => entry.medicine_id !== item.medicine_id)); requestKey.current = null; }}>Убрать</button>
    </div>)}</div>}
    <button type="button" className="admin-primary-button" disabled={busy || selected.length === 0} onClick={save}
      style={{ marginTop: 14, minHeight: 44 }}>{busy ? 'Сохраняем…' : `Добавить выбранные (${selected.length})`}</button>
    {error && <p role="alert" style={{ color: '#c62828' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#2e7d32' }}>{message}</p>}
  </section>;
}

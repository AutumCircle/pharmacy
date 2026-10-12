'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addManualOrderMedicine } from '../actions';
import type { OrderStatus } from '@/lib/api-v1/types';

export default function ManualOrderMedicineEditor({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const delivered = status === 'delivered';
  const inputStyle = { minWidth: 0, width: '100%', minHeight: 44, padding: '8px 10px', border: '1px solid #d0d5dd', borderRadius: 8, font: 'inherit' };
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestKey = useRef<string | null>(null);

  async function save() {
    const normalizedPrice = price.replace(',', '.').trim();
    if (name.trim().length < 2 || name.trim().length > 200 ||
      !/^\d{1,6}(?:\.\d{1,2})?$/.test(normalizedPrice) || Number(normalizedPrice) <= 0 ||
      !Number.isFinite(quantity) || quantity < 0.5 || quantity > 99 || !Number.isInteger(quantity * 2)) {
      setError('Проверьте название, цену и количество'); return;
    }
    if (delivered && !window.confirm('Позиция добавится в доставленный заказ. Его сумма изменится задним числом, плата за доставку не изменится. Продолжить?')) return;
    if (status === 'cancelled' && !window.confirm('Заказ отменён. Добавить позицию для истории? Статус останется отменённым.')) return;
    setBusy(true); setError(''); setMessage('');
    if (!requestKey.current) requestKey.current = crypto.randomUUID();
    const result = await addManualOrderMedicine(orderId,
      { medicine_name: name.trim(), price: normalizedPrice, quantity }, requestKey.current);
    if (result.success) {
      setName(''); setPrice(''); setQuantity(1); setOpen(false); requestKey.current = null;
      setMessage('Лекарство добавлено в заказ. В каталог оно не добавлено.');
      router.refresh();
    } else setError(result.error);
    setBusy(false);
  }

  return <section style={{ background: 'white', padding: 20, borderRadius: 12, marginTop: 16 }}>
    <button type="button" className="admin-primary-button" onClick={() => setOpen((value) => !value)}>
      {open ? 'Закрыть ручной ввод' : '+ Лекарство вне каталога'}
    </button>
    {open && <div style={{ marginTop: 14 }}>
      <p>Название и цена сохраняются только в этом заказе. Автоматической наценки нет; закупочную цену при необходимости можно изменить ниже в составе заказа.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <input aria-label="Название лекарства вне каталога" placeholder="Название лекарства" maxLength={200}
          style={inputStyle} value={name} onChange={(event) => { setName(event.target.value); requestKey.current = null; }} />
        <input aria-label="Цена лекарства в сомони" type="number" inputMode="decimal" min="0.01" max="999999.99" step="0.01"
          style={inputStyle} placeholder="Цена, с." value={price} onChange={(event) => { setPrice(event.target.value); requestKey.current = null; }} />
        <input aria-label="Количество лекарства" type="number" min={0.5} max={99} step={0.5} value={quantity}
          style={inputStyle} onChange={(event) => { setQuantity(Number(event.target.value)); requestKey.current = null; }} />
      </div>
      <button type="button" className="admin-primary-button" disabled={busy} onClick={save} style={{ marginTop: 12, minHeight: 44 }}>
        {busy ? 'Сохраняем…' : 'Добавить в заказ'}
      </button>
    </div>}
    {error && <p role="alert" style={{ color: '#c62828' }}>{error}</p>}
    {message && <p role="status" style={{ color: '#2e7d32' }}>{message}</p>}
  </section>;
}

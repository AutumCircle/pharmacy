'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@/lib/api-v1/types';
import MedicinePicker, { invalidLine, lineTotal, type PickerLine } from '@/app/staff/orders/MedicinePicker';
import { parsePrice } from '@/app/staff/format';
import { addManualOrderMedicine, addOrderMedicines, searchOrderMedicines } from '../actions';
import { money } from '../ui';

export default function OrderAddItems({ orderId, status, websiteOrder }: { orderId: string; status: OrderStatus; websiteOrder: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<PickerLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef<{ items?: string; manual: Record<string, string> }>({ manual: {} });

  const search = useCallback(async (query: string) => {
    const result = await searchOrderMedicines(query);
    if (!result.success) throw new Error(result.error);
    return result.medicines;
  }, []);

  async function save() {
    const broken = invalidLine(lines);
    if (broken) { setError(`Укажите цену: ${broken.medicine_name}`); return; }
    if (status === 'delivered' && !window.confirm('Товары добавятся в доставленный заказ, его сумма изменится. Продолжить?')) return;
    if (status === 'cancelled' && !window.confirm('Заказ отменён. Добавить товары для истории? Статус останется отменённым.')) return;
    setBusy(true); setError('');
    const catalog = lines.filter((line) => line.medicine_id !== null);
    if (catalog.length) {
      keys.current.items ??= crypto.randomUUID();
      const result = await addOrderMedicines(orderId, catalog.map((line) => ({
        medicine_id: line.medicine_id as number, quantity: line.quantity, unit_price: parsePrice(line.price) ?? undefined })),
      keys.current.items);
      if (!result.success) { setError(result.error); setBusy(false); return; }
      keys.current.items = undefined;
      setLines((current) => current.filter((line) => line.medicine_id === null));
    }
    for (const line of lines.filter((entry) => entry.medicine_id === null)) {
      keys.current.manual[line.key] ??= crypto.randomUUID();
      const result = await addManualOrderMedicine(orderId, { medicine_name: line.medicine_name,
        price: parsePrice(line.price) as string, quantity: line.quantity }, keys.current.manual[line.key]);
      if (!result.success) { setError(result.error); setBusy(false); router.refresh(); return; }
      delete keys.current.manual[line.key];
      setLines((current) => current.filter((entry) => entry.key !== line.key));
    }
    setBusy(false); setOpen(false); setLines([]); router.refresh();
  }

  if (!open) return <button type="button" className="ao-btn ao-btn-outline od-add" onClick={() => setOpen(true)}>+ Добавить товар</button>;
  return <div className="od-adder">
    <MedicinePicker lines={lines} search={search}
      onChange={(next) => { setLines(next); setError(''); keys.current.items = undefined; }}
      defaultPrice={(medicine) => websiteOrder ? medicine.selling_unit_price : medicine.base_unit_price} />
    {error && <p className="od-error" role="alert">{error}</p>}
    <div className="od-actions">
      <button type="button" className="ao-btn ao-btn-primary" disabled={busy || !lines.length} onClick={() => void save()}>
        {busy ? 'Сохраняем…' : lines.length ? `Добавить · ${money(lineTotal(lines), 2)}` : 'Выберите товар'}</button>
      <button type="button" className="ao-btn ao-btn-ghost" disabled={busy} onClick={() => { setOpen(false); setLines([]); setError(''); }}>Отмена</button>
    </div>
  </div>;
}

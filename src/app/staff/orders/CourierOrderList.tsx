'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { CourierOrder, CourierOrderStatus, StaffOrderMedicine } from '@/lib/api-v1/staff-types';

const labels: Record<CourierOrderStatus, string> = {
  pending: 'Новый', confirmed: 'Собирается', delivering: 'В пути',
  delivered: 'Доставлен', cancelled: 'Отменён',
};
const transitions: Record<CourierOrderStatus, CourierOrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['delivering', 'cancelled'],
  delivering: ['delivered', 'cancelled'],
  delivered: [], cancelled: [],
};
const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Звонок' };

function OrderCard({ order }: { order: CourierOrder }) {
  const router = useRouter();
  const [status, setStatus] = useState(order.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState(Number(order.delivery_courier_amount || 0).toFixed(2));
  const [amountState, setAmountState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [editingItems, setEditingItems] = useState(false);
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineResults, setMedicineResults] = useState<StaffOrderMedicine[]>([]);
  const [selectedMedicines, setSelectedMedicines] = useState<Array<StaffOrderMedicine & { quantity: number }>>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [itemBusy, setItemBusy] = useState(false);
  const [itemMessage, setItemMessage] = useState('');
  const itemRequestKey = useRef<string | null>(null);

  async function searchMedicines() {
    if (medicineQuery.trim().length < 2) { setError('Введите минимум 2 символа'); return; }
    setSearchBusy(true); setError('');
    try {
      const response = await fetch(`/api/staff/order-medicines?q=${encodeURIComponent(medicineQuery.trim())}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || 'Поиск не выполнен');
      setMedicineResults(result.data || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка поиска');
    } finally { setSearchBusy(false); }
  }

  async function saveMedicines() {
    if (!selectedMedicines.length) return;
    if (status === 'delivered' && !window.confirm('Лекарства добавятся в уже доставленный заказ. Сумма заказа изменится задним числом, плата за доставку не изменится. Продолжить?')) return;
    setItemBusy(true); setError(''); setItemMessage('');
    if (!itemRequestKey.current) itemRequestKey.current = crypto.randomUUID();
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(order.order_id)}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': itemRequestKey.current },
        body: JSON.stringify({ items: selectedMedicines.map((item) =>
          ({ medicine_id: item.medicine_id, quantity: item.quantity })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || 'Не удалось добавить лекарства');
      setItemMessage(`Сохранено: новых ${result.data.added}, количество увеличено у ${result.data.quantity_increased}.`);
      setSelectedMedicines([]); setMedicineResults([]); setMedicineQuery(''); setEditingItems(false);
      itemRequestKey.current = null;
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    } finally { setItemBusy(false); }
  }

  async function saveAmount() {
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { setError('Введите корректную сумму'); return; }
    setAmountState('saving'); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(order.order_id)}/delivery`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_courier_amount: value }),
      });
      if (!response.ok) throw new Error('Не удалось сохранить сумму. Повторите попытку.');
      setAmount(value.toFixed(2)); setAmountState('saved');
    } catch (cause) {
      setAmountState('idle');
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    }
  }

  async function changeStatus(next: CourierOrderStatus) {
    let reason: string | undefined;
    if (next === 'cancelled') {
      reason = window.prompt('Причина отмены заказа')?.trim();
      if (!reason) return;
    }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(order.order_id)}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, expected_current_status: status, ...(reason ? { reason } : {}) }),
      });
      if (!response.ok) {
        if (response.status === 409) { router.refresh(); throw new Error('Статус уже изменился. Обновите страницу.'); }
        throw new Error('Не удалось изменить статус. Повторите попытку.');
      }
      setStatus(next);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    } finally { setBusy(false); }
  }

  return <article className="courier-order-card">
    <div className="courier-order-heading">
      <div><strong>Заказ {order.order_reference || order.order_id}</strong>
        <small>{new Date(order.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Dushanbe' })}</small></div>
      <div className="courier-order-pay"><strong>{Number(amount || 0).toLocaleString('ru-RU')} с.</strong>
        <small>заработок курьера</small><span className={`courier-order-status ${status}`}>{labels[status]}</span></div>
    </div>
    <div className="courier-order-medicines">
      <b>Лекарства</b>
      {order.medicines.length ? <ul>{order.medicines.map((item, index) => <li key={`${item.medicine_id}-${index}`}>
        {item.medicine_name} × {item.quantity}
        {item.base_unit_price !== null && <small> · цена аптеки {Number(item.base_unit_price).toFixed(2)} с.</small>}
      </li>)}</ul> : <p>Лекарства ещё не указаны.</p>}
      {order.pharmacy_id === 1 && status !== 'cancelled' &&
        <button type="button" className="courier-add-medicines" onClick={() => setEditingItems((value) => !value)}>
          {editingItems ? 'Закрыть' : '+ Добавить лекарства'}
        </button>}
      {order.pharmacy_id === 2 && <p>Для аптеки 2 каталог пока не подключён.</p>}
      {itemMessage && <p className="staff-order-success" role="status">{itemMessage}</p>}
      {editingItems && <div className="courier-medicine-editor">
        <div className="staff-search"><input aria-label="Название лекарства" value={medicineQuery}
          onChange={(event) => setMedicineQuery(event.target.value)} placeholder="Название лекарства" />
          <button type="button" disabled={searchBusy} onClick={searchMedicines}>{searchBusy ? 'Поиск…' : 'Найти'}</button></div>
        {medicineResults.length > 0 && <div className="staff-picker-results">{medicineResults.map((medicine) =>
          <div key={medicine.medicine_id}><span><strong>{medicine.medicine_name}</strong>
            <small>Цена аптеки {Number(medicine.base_unit_price).toFixed(2)} с.</small></span>
            <button type="button" disabled={selectedMedicines.length >= 20 || selectedMedicines.some((item) => item.medicine_id === medicine.medicine_id)}
              onClick={() => { setSelectedMedicines((items) => [...items, { ...medicine, quantity: 1 }]); itemRequestKey.current = null; }}>
              {selectedMedicines.some((item) => item.medicine_id === medicine.medicine_id) ? 'Выбрано' :
                order.medicines.some((item) => item.medicine_id === medicine.medicine_id) ? 'Увеличить' : 'Добавить'}
            </button></div>)}</div>}
        {selectedMedicines.length > 0 && <div className="staff-selected-items">{selectedMedicines.map((item) =>
          <div key={item.medicine_id}><span><strong>{item.medicine_name}</strong></span>
            <input aria-label={`Добавить количество: ${item.medicine_name}`} type="number" min={1} max={99}
              value={item.quantity} onChange={(event) => {
                const quantity = Math.min(99, Math.max(1, Number(event.target.value) || 1));
                setSelectedMedicines((items) => items.map((entry) => entry.medicine_id === item.medicine_id
                  ? { ...entry, quantity } : entry)); itemRequestKey.current = null;
              }} />
            <button type="button" onClick={() => { setSelectedMedicines((items) => items.filter((entry) =>
              entry.medicine_id !== item.medicine_id)); itemRequestKey.current = null; }}>Убрать</button></div>)}</div>}
        <button type="button" className="staff-submit" disabled={itemBusy || selectedMedicines.length === 0}
          onClick={saveMedicines}>{itemBusy ? 'Сохраняем…' : `Сохранить лекарства (${selectedMedicines.length})`}</button>
      </div>}
    </div>
    <div className="courier-order-details">
      <p><b>Аптека:</b> {order.pharmacy_id ? `Аптека ${order.pharmacy_id}` : 'Не указана'}</p>
      <p><b>Клиент:</b> {order.customer_name || 'Имя не указано'}</p>
      <p><b>Телефон:</b> <a href={`tel:${order.phone}`}>{order.phone}</a></p>
      <p><b>Адрес:</b> {order.address}</p>
      {order.landmark && <p><b>Ориентир:</b> {order.landmark}</p>}
      {order.notes && <p><b>Комментарий:</b> {order.notes}</p>}
      {order.order_source && <p><b>Источник:</b> {sourceLabels[order.order_source]}</p>}
    </div>
    {status !== 'cancelled' && <div className="courier-fee-editor">
      <label htmlFor={`fee-${order.order_id}`}><b>Получено за доставку:</b></label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input id={`fee-${order.order_id}`} type="number" inputMode="decimal" min="0" max="1000000" step="0.01"
          value={amount} onChange={(event) => { setAmount(event.target.value); setAmountState('idle'); }}
          style={{ width: 120, minHeight: 44, padding: '6px 10px', font: 'inherit', borderRadius: 8, border: '1px solid #d0d5dd' }} />
        <span>с.</span>
        <button type="button" disabled={amountState === 'saving'} onClick={saveAmount}>
          {amountState === 'saving' ? '…' : amountState === 'saved' ? '✓ Сохранено' : 'Сохранить'}</button>
      </div>
    </div>}
    {transitions[status].length > 0 && <div className="courier-order-actions">
      {transitions[status].map((next) => <button key={next} type="button" disabled={busy}
        onClick={() => changeStatus(next)}>{next === 'cancelled' ? 'Отменить' : `→ ${labels[next]}`}</button>)}
    </div>}
    {error && <p className="courier-order-error" role="alert">{error}</p>}
  </article>;
}

export default function CourierOrderList({ orders }: { orders: CourierOrder[] }) {
  if (orders.length === 0) return <div className="staff-order-form">Заказов пока нет.</div>;
  return <div className="courier-order-list">{orders.map((order) => <OrderCard key={order.order_id} order={order} />)}</div>;
}

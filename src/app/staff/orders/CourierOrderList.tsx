'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { CourierOrder, CourierOrderStatus } from '@/lib/api-v1/staff-types';
import { formatOrderDateTime } from '@/lib/order-time';
import { money, parsePrice, quantityLabel } from '../format';
import MedicinePicker, { invalidLine, lineTotal, type PickerLine } from './MedicinePicker';

const labels: Record<CourierOrderStatus, string> = {
  pending: 'Новый', confirmed: 'Собирается', delivering: 'В пути',
  delivered: 'Доставлен', cancelled: 'Отменён',
};
const nextStep: Partial<Record<CourierOrderStatus, { status: CourierOrderStatus; label: string }>> = {
  pending: { status: 'confirmed', label: 'Принять заказ' },
  confirmed: { status: 'delivering', label: 'Выехал к клиенту' },
  delivering: { status: 'delivered', label: 'Доставлен' },
};
const sourceLabels = { instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Звонок' };

async function send(url: string, method: 'POST' | 'PATCH', body: unknown, idempotencyKey?: string) {
  const response = await fetch(url, {
    method, body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Не удалось сохранить. Повторите попытку.');
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return result;
}

function localPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('992') ? digits.slice(3) : digits.slice(-9);
}

function CustomerBlock({ order }: { order: CourierOrder }) {
  const router = useRouter();
  const [name, setName] = useState(order.customer_name || '');
  const [phone, setPhone] = useState(order.phone);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function open() { setDraftName(name); setDraftPhone(localPhone(phone)); setError(''); setEditing(true); }

  async function save() {
    if (!/^\d{9}$/.test(draftPhone)) { setError('Телефон — 9 цифр после +992'); return; }
    setBusy(true); setError('');
    try {
      const result = await send(`/api/staff/orders/${encodeURIComponent(order.order_id)}/customer`, 'PATCH',
        { customer_name: draftName.trim(), phone: draftPhone });
      setName(result.data.customer_name); setPhone(result.data.phone); setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    } finally { setBusy(false); }
  }

  if (editing) {
    return <div className="c-block c-edit">
      <label>Имя клиента<input value={draftName} maxLength={120} autoComplete="off"
        onChange={(event) => setDraftName(event.target.value)} placeholder="Например: Фарход" /></label>
      <label>Телефон<div className="c-phone"><b>+992</b><input value={draftPhone} inputMode="numeric" maxLength={9}
        onChange={(event) => setDraftPhone(event.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="917123456" /></div></label>
      {error && <p className="c-error" role="alert">{error}</p>}
      <div className="c-row-actions">
        <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setEditing(false)}>Отмена</button>
      </div>
    </div>;
  }

  return <div className="c-block c-customer">
    <div className="c-customer-main">
      <strong>{name || 'Имя не указано'}</strong>
      <a href={`tel:${phone}`}>{phone}</a>
    </div>
    <a className="c-icon-btn c-call" href={`tel:${phone}`} aria-label={`Позвонить ${phone}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" /></svg>
    </a>
    <button type="button" className="c-link" onClick={open}>Изменить</button>
  </div>;
}

function ItemsBlock({ order, status }: { order: CourierOrder; status: CourierOrderStatus }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState<PickerLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const keys = useRef<{ items?: string; manual?: string }>({});
  const total = Number(order.order_total ?? order.medicines.reduce((sum, item) => sum + Number(item.line_total ?? 0), 0));

  function change(next: PickerLine[]) { setLines(next); keys.current = {}; setError(''); }

  async function save() {
    if (!lines.length) return;
    const broken = invalidLine(lines);
    if (broken) { setError(`Укажите цену: ${broken.medicine_name}`); return; }
    if (status === 'delivered' && !window.confirm('Заказ уже доставлен. Сумма заказа изменится, плата за доставку — нет. Добавить?')) return;
    setBusy(true); setError(''); setNotice('');
    const base = `/api/staff/orders/${encodeURIComponent(order.order_id)}`;
    const catalog = lines.filter((line) => line.medicine_id !== null);
    const manual = lines.filter((line) => line.medicine_id === null);
    try {
      if (catalog.length) {
        keys.current.items ??= crypto.randomUUID();
        await send(`${base}/items`, 'POST', { items: catalog.map((line) => ({
          medicine_id: line.medicine_id, quantity: line.quantity, unit_price: parsePrice(line.price) })) }, keys.current.items);
      }
      if (manual.length) {
        keys.current.manual ??= crypto.randomUUID();
        await send(`${base}/manual-items`, 'POST', { manual_items: manual.map((line) => ({
          medicine_name: line.medicine_name, price: parsePrice(line.price), quantity: line.quantity })) }, keys.current.manual);
      }
      setNotice(`Добавлено: ${lines.length}`);
      setLines([]); setAdding(false); keys.current = {};
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    } finally { setBusy(false); }
  }

  return <div className="c-block">
    <div className="c-block-title"><span>Товары</span>{order.medicines.length > 0 && <strong>{money(total)}</strong>}</div>
    {order.medicines.length ? <ul className="c-items">{order.medicines.map((item) =>
      <li key={item.order_item_id ?? `${item.medicine_id}-${item.medicine_name}`}>
        <span className="c-item-name">{item.medicine_name}</span>
        <span className="c-item-qty">{quantityLabel(item.quantity)} × {money(item.selling_unit_price)}</span>
        <span className="c-item-sum">{money(item.line_total)}</span>
      </li>)}</ul> : <p className="c-muted">Товаров пока нет.</p>}
    {notice && <p className="c-notice" role="status">{notice}</p>}
    {status !== 'cancelled' && !adding &&
      <button type="button" className="c-btn c-btn-outline c-btn-wide" onClick={() => { setAdding(true); setNotice(''); }}>+ Добавить товар</button>}
    {adding && <div className="c-adder">
      <MedicinePicker lines={lines} onChange={change}
        defaultPrice={(medicine) => order.website_order ? medicine.selling_unit_price : medicine.base_unit_price} />
      {error && <p className="c-error" role="alert">{error}</p>}
      <div className="c-row-actions">
        <button type="button" className="c-btn c-btn-primary" disabled={busy || !lines.length} onClick={save}>
          {busy ? 'Сохраняем…' : lines.length ? `Добавить · ${money(lineTotal(lines))}` : 'Выберите товар'}
        </button>
        <button type="button" className="c-btn c-btn-ghost" disabled={busy}
          onClick={() => { setAdding(false); setLines([]); setError(''); }}>Отмена</button>
      </div>
    </div>}
  </div>;
}

function DeliveryFee({ order }: { order: CourierOrder }) {
  const initial = Number(order.delivery_courier_amount || 0);
  const [amount, setAmount] = useState(initial ? String(initial) : '');
  const [saved, setSaved] = useState(String(initial));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');

  async function save() {
    const value = Number(amount.replace(',', '.') || 0);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { setError('Введите сумму от 0'); return; }
    setState('saving'); setError('');
    try {
      await send(`/api/staff/orders/${encodeURIComponent(order.order_id)}/delivery`, 'PATCH', { delivery_courier_amount: value });
      setSaved(String(value)); setState('saved');
    } catch (cause) {
      setState('idle'); setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    }
  }

  const dirty = String(Number(amount.replace(',', '.') || 0)) !== saved;
  return <div className="c-block c-fee">
    <label htmlFor={`fee-${order.order_id}`}>Мне за доставку</label>
    <div className="c-fee-row">
      <div className="c-money-input"><input id={`fee-${order.order_id}`} inputMode="decimal" value={amount} placeholder="0"
        onChange={(event) => { setAmount(event.target.value); setState('idle'); }} /><span>с.</span></div>
      <button type="button" className="c-btn c-btn-outline" disabled={state === 'saving' || !dirty} onClick={save}>
        {state === 'saving' ? '…' : state === 'saved' && !dirty ? 'Сохранено ✓' : 'Сохранить'}
      </button>
    </div>
    {error && <p className="c-error" role="alert">{error}</p>}
  </div>;
}

function OrderCard({ order }: { order: CourierOrder }) {
  const router = useRouter();
  const [status, setStatus] = useState(order.status);
  const [open, setOpen] = useState(order.status !== 'delivered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const step = nextStep[status];

  async function changeStatus(next: CourierOrderStatus, cancelReason?: string) {
    setBusy(true); setError('');
    try {
      await send(`/api/staff/orders/${encodeURIComponent(order.order_id)}/status`, 'PATCH',
        { status: next, expected_current_status: status, ...(cancelReason ? { reason: cancelReason } : {}) });
      setStatus(next); setCancelling(false); setReason('');
      if (next === 'delivered') setOpen(false);
      router.refresh();
    } catch (cause) {
      if ((cause as { status?: number }).status === 409) { router.refresh(); setError('Статус уже изменился — список обновлён.'); }
      else setError(cause instanceof Error ? cause.message : 'Ошибка сети');
    } finally { setBusy(false); }
  }

  return <article className={`c-card c-status-${status}`}>
    <button type="button" className="c-card-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="c-card-id">
        <strong>№ {order.order_reference || order.order_id.slice(-6)}</strong>
        <small>{formatOrderDateTime(order.created_at)}</small>
      </span>
      <span className="c-card-tags">
        {order.pharmacy_id && <span className="c-chip">Аптека {order.pharmacy_id}</span>}
        <span className={`c-pill c-pill-${status}`}>{labels[status]}</span>
      </span>
    </button>
    {!open && <button type="button" className="c-card-summary" onClick={() => setOpen(true)}>
      <span>{order.customer_name || 'Без имени'} · {order.address}</span>
      <strong>{money(order.order_total)}</strong>
    </button>}
    {open && <div className="c-card-body">
      <CustomerBlock order={order} />
      <div className="c-block c-address">
        <p className="c-address-main">{order.address}</p>
        {order.landmark && <p><span>Ориентир:</span> {order.landmark}</p>}
        {order.notes && <p className="c-note"><span>Комментарий:</span> {order.notes}</p>}
        {order.order_source && <p className="c-muted">Источник: {sourceLabels[order.order_source]}</p>}
      </div>
      <ItemsBlock order={order} status={status} />
      {status !== 'cancelled' && <DeliveryFee order={order} />}
      {error && <p className="c-error" role="alert">{error}</p>}
      {cancelling ? <div className="c-block c-cancel">
        <label>Причина отмены<textarea rows={2} maxLength={300} value={reason} autoFocus
          onChange={(event) => setReason(event.target.value)} placeholder="Например: клиент не отвечает" /></label>
        <div className="c-row-actions">
          <button type="button" className="c-btn c-btn-danger" disabled={busy || !reason.trim()}
            onClick={() => changeStatus('cancelled', reason.trim())}>{busy ? '…' : 'Отменить заказ'}</button>
          <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setCancelling(false)}>Назад</button>
        </div>
      </div> : step && <div className="c-actions">
        <button type="button" className="c-btn c-btn-primary c-btn-wide" disabled={busy}
          onClick={() => changeStatus(step.status)}>{busy ? 'Сохраняем…' : step.label}</button>
        <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setCancelling(true)}>Отменить</button>
      </div>}
    </div>}
  </article>;
}

export default function CourierOrderList({ orders }: { orders: CourierOrder[] }) {
  if (orders.length === 0) return <div className="c-empty"><strong>Заказов нет</strong><span>Новые заказы появятся здесь.</span></div>;
  return <div className="c-list">{orders.map((order) => <OrderCard key={order.order_id} order={order} />)}</div>;
}

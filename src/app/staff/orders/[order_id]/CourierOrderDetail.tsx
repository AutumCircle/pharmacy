'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { CourierOrder, CourierOrderStatus } from '@/lib/api-v1/staff-types';
import { CHECKLIST_STEPS, checklistProgress, isStepDone } from '@/lib/courier-checklist';
import { formatOrderDateTime } from '@/lib/order-time';
import {
  answersProgressText, confirmedAmountText, courierItemAnswerLabel, courierItemAnswerTone, isAmountConfirmed,
} from '@/lib/pharmacy-answers';
import { money, parsePrice, priceInput, quantityLabel } from '../../format';
import MedicinePicker, { invalidLine, lineTotal, type PickerLine } from '../MedicinePicker';
import QuantityStepper from '../QuantityStepper';
import { nextStep, statusFlow, statusLabels } from '../status';

type Item = CourierOrder['medicines'][number];

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, idempotencyKey?: string) {
  const response = await fetch(url, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Не удалось сохранить. Повторите попытку.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result;
}

function errorText(cause: unknown) { return cause instanceof Error ? cause.message : 'Нет связи. Повторите попытку.'; }

function localPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('992') ? digits.slice(3) : digits.slice(-9);
}

function Progress({ status }: { status: CourierOrderStatus }) {
  if (status === 'cancelled') return <p className="c-cancelled-banner">Заказ отменён</p>;
  const current = statusFlow.indexOf(status);
  return <ol className="c-progress" aria-label="Этапы заказа">
    {statusFlow.map((step, index) => <li key={step} className={index < current ? 'done' : index === current ? 'current' : ''}
      aria-current={index === current ? 'step' : undefined}><span aria-hidden="true" />{statusLabels[step]}</li>)}
  </ol>;
}

function CustomerSection({ order, base, onSaved }: { order: CourierOrder; base: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ customer_name: '', phone: '', address: '', landmark: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function open() {
    setForm({ customer_name: order.customer_name || '', phone: localPhone(order.phone),
      address: order.address || '', landmark: order.landmark || '' });
    setError(''); setEditing(true);
  }

  async function save() {
    if (!/^\d{9}$/.test(form.phone)) { setError('Телефон — 9 цифр после +992'); return; }
    if (form.address.trim().length < 3) { setError('Укажите адрес'); return; }
    if (form.landmark.trim().length < 2) { setError('Укажите ориентир'); return; }
    setBusy(true); setError('');
    try {
      await send(`${base}/customer`, 'PATCH', form);
      setEditing(false); onSaved();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  if (editing) {
    const field = (key: keyof typeof form) => ({
      value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value }),
    });
    return <section className="c-block c-edit" aria-label="Изменить данные клиента">
      <h2 className="c-block-title">Данные клиента</h2>
      <label>Имя<input {...field('customer_name')} maxLength={120} autoComplete="off" placeholder="Например: Фарход" /></label>
      <label>Телефон<div className="c-phone"><b>+992</b><input value={form.phone} inputMode="numeric" maxLength={9}
        onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/\D/g, '').slice(0, 9) })} /></div></label>
      <label>Адрес<input {...field('address')} maxLength={500} autoComplete="off" /></label>
      <label>Ориентир<input {...field('landmark')} maxLength={300} autoComplete="off" /></label>
      {error && <p className="c-error" role="alert">{error}</p>}
      <div className="c-row-actions">
        <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setEditing(false)}>Отмена</button>
      </div>
    </section>;
  }

  return <section className="c-block">
    <div className="c-block-title"><h2>Клиент</h2>
      {order.own_order && <button type="button" className="c-link" onClick={open}>Изменить</button>}</div>
    <div className="c-customer">
      <div className="c-customer-main">
        <strong>{order.customer_name || 'Имя не указано'}</strong>
        <span>{order.phone}</span>
      </div>
      <a className="c-call" href={`tel:${order.phone}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" /></svg>
        Позвонить</a>
    </div>
    <div className="c-address">
      <p className="c-address-main">{order.address}</p>
      {order.landmark && <p><span>Ориентир:</span> {order.landmark}</p>}
      {order.notes && <p className="c-note"><span>Комментарий:</span> {order.notes}</p>}
    </div>
    {!order.own_order && <p className="c-muted c-small">Заказ с сайта: данные клиента и товары меняет только администратор.</p>}
  </section>;
}

function ItemRow({ item, base, editable, delivered, onSaved }: {
  item: Item; base: string; editable: boolean; delivered: boolean; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(Number(item.quantity));
  const [price, setPrice] = useState(priceInput(item.selling_unit_price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = `${base}/items/${item.order_item_id}`;

  function start() { setQuantity(Number(item.quantity)); setPrice(priceInput(item.selling_unit_price)); setError(''); setOpen(true); }

  async function save() {
    const cleanPrice = parsePrice(price);
    if (!cleanPrice) { setError('Укажите цену, например 25 или 12,50'); return; }
    if (delivered && !window.confirm('Заказ уже доставлен. Изменить сумму заказа?')) return;
    setBusy(true); setError('');
    try { await send(url, 'PATCH', { quantity, unit_price: cleanPrice }); setOpen(false); onSaved(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Удалить «${item.medicine_name}» из заказа?`)) return;
    setBusy(true); setError('');
    try { await send(url, 'DELETE'); onSaved(); } catch (cause) { setError(errorText(cause)); setBusy(false); }
  }

  const answerLabel = courierItemAnswerLabel(item);
  const summary = <>
    <span className="c-item-name">{item.medicine_name}</span>
    <span className="c-item-qty">{quantityLabel(item.quantity)} шт. × {money(item.selling_unit_price)}</span>
    <span className="c-item-sum">{money(item.line_total)}</span>
    {answerLabel && <span className={`c-item-answer pa-tone-${courierItemAnswerTone(item)}`}>{answerLabel}</span>}
  </>;

  if (!editable) return <li className="c-item">{summary}</li>;
  if (!open) return <li className="c-item"><button type="button" className="c-item-button" onClick={start}
    aria-label={`Изменить ${item.medicine_name}`}>{summary}<span className="c-item-edit" aria-hidden="true">✎</span></button></li>;
  const valid = parsePrice(price) !== null;
  return <li className="c-item c-item-open">
    <span className="c-item-name">{item.medicine_name}</span>
    <div className="mp-line-body">
      <QuantityStepper value={quantity} onChange={setQuantity} disabled={busy} />
      <label className={valid ? 'mp-money' : 'mp-money mp-money-invalid'}><span className="sr-only">Цена за 1 шт.</span>
        <input value={price} inputMode="decimal" onChange={(event) => setPrice(event.target.value)} /><span aria-hidden="true">с.</span></label>
      <span className="mp-line-total">{valid ? money(Number(parsePrice(price)) * quantity) : '—'}</span>
    </div>
    {error && <p className="c-error" role="alert">{error}</p>}
    <div className="c-row-actions">
      <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>
      <button type="button" className="c-btn c-btn-danger-text" disabled={busy} onClick={remove}>Удалить</button>
    </div>
  </li>;
}

function ItemsSection({ order, base, onSaved }: { order: CourierOrder; base: string; onSaved: () => void }) {
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState<PickerLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef<{ items?: string; manual?: string }>({});
  const editable = order.own_order && order.status !== 'cancelled';
  const delivered = order.status === 'delivered';

  async function save() {
    const broken = invalidLine(lines);
    if (broken) { setError(`Укажите цену: ${broken.medicine_name}`); return; }
    if (delivered && !window.confirm('Заказ уже доставлен. Добавить товары и изменить сумму?')) return;
    setBusy(true); setError('');
    const catalog = lines.filter((line) => line.medicine_id !== null);
    const manual = lines.filter((line) => line.medicine_id === null);
    try {
      if (catalog.length) {
        keys.current.items ??= crypto.randomUUID();
        await send(`${base}/items`, 'POST', { items: catalog.map((line) => ({
          medicine_id: line.medicine_id, quantity: line.quantity, unit_price: parsePrice(line.price) })) }, keys.current.items);
        keys.current.items = undefined;
        setLines((current) => current.filter((line) => line.medicine_id === null));
      }
      if (manual.length) {
        keys.current.manual ??= crypto.randomUUID();
        await send(`${base}/manual-items`, 'POST', { manual_items: manual.map((line) => ({
          medicine_name: line.medicine_name, price: parsePrice(line.price), quantity: line.quantity })) }, keys.current.manual);
        keys.current.manual = undefined;
      }
      setLines([]); setAdding(false); onSaved();
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  return <section className="c-block">
    <div className="c-block-title"><h2>Товары</h2><strong>{money(order.order_total)}</strong></div>
    {order.medicines.length ? <ul className="c-items">{order.medicines.map((item) =>
      <ItemRow key={`${item.order_item_id}-${item.quantity}-${item.selling_unit_price}`} item={item} base={base}
        editable={editable} delivered={delivered} onSaved={onSaved} />)}</ul>
      : <p className="c-muted">Товаров пока нет.</p>}
    {order.website_order && order.status !== 'cancelled' && 'confirmed_total' in order && order.medicines.length > 0 &&
      <p className={`c-confirmed${isAmountConfirmed(order) ? ' ok' : ''}`} role="status">{confirmedAmountText(order)}</p>}
    {editable && order.medicines.length > 0 && !adding && <p className="c-muted c-small">Нажмите на товар, чтобы изменить количество, цену или удалить.</p>}
    {editable && !adding && <button type="button" className="c-btn c-btn-outline c-btn-wide" onClick={() => setAdding(true)}>+ Добавить товар</button>}
    {adding && <div className="c-adder">
      <MedicinePicker lines={lines} onChange={(next) => { setLines(next); setError(''); keys.current = {}; }}
        defaultPrice={(medicine) => medicine.base_unit_price} />
      {error && <p className="c-error" role="alert">{error}</p>}
      <div className="c-row-actions">
        <button type="button" className="c-btn c-btn-primary" disabled={busy || !lines.length} onClick={save}>
          {busy ? 'Сохраняем…' : lines.length ? `Сохранить · ${money(lineTotal(lines))}` : 'Выберите товар'}</button>
        <button type="button" className="c-btn c-btn-ghost" disabled={busy}
          onClick={() => { setAdding(false); setLines([]); setError(''); }}>Отмена</button>
      </div>
    </div>}
  </section>;
}

function FeeSection({ order, base }: { order: CourierOrder; base: string }) {
  const initial = Number(order.delivery_courier_amount || 0);
  const [amount, setAmount] = useState(initial ? String(initial) : '');
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Number(amount.replace(',', '.') || 0);
  const dirty = value !== saved;

  async function save() {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { setError('Введите сумму от 0'); return; }
    setBusy(true); setError('');
    try { await send(`${base}/delivery`, 'PATCH', { delivery_courier_amount: value }); setSaved(value); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  return <section className="c-block c-fee">
    <label htmlFor="courier-fee" className="c-block-title"><h2>Мне за доставку</h2></label>
    <div className="c-fee-row">
      <div className="mp-money c-fee-input"><input id="courier-fee" inputMode="decimal" value={amount} placeholder="0"
        onChange={(event) => setAmount(event.target.value)} /><span>с.</span></div>
      <button type="button" className="c-btn c-btn-outline" disabled={busy || !dirty} onClick={save}>
        {busy ? '…' : dirty ? 'Сохранить' : 'Сохранено ✓'}</button>
    </div>
    {error && <p className="c-error" role="alert">{error}</p>}
  </section>;
}

function ChecklistSection({ order, base, statusBusy, onStatus, onConflict }: {
  order: CourierOrder; base: string; statusBusy: boolean;
  onStatus: (next: CourierOrderStatus) => void; onConflict: () => void;
}) {
  const [steps, setSteps] = useState<number[]>(order.checklist_steps ?? []);
  const [saving, setSaving] = useState<number[]>([]);
  const [error, setError] = useState('');
  const view = { ...order, checklist_steps: steps };
  const progress = checklistProgress(view);
  if (!progress) return null;

  const mark = (step: number, done: boolean) => setSteps((current) => done
    ? [...current.filter((value) => value !== step), step].sort((a, b) => a - b)
    : current.filter((value) => value !== step));

  async function toggle(step: number, done: boolean) {
    setError('');
    mark(step, done);
    setSaving((current) => [...current, step]);
    try {
      const result = await send(`${base}/checklist`, 'PATCH', { step, done });
      const saved: unknown = result?.data?.checklist_steps;
      if (Array.isArray(saved)) mark(step, saved.includes(step));
    } catch (cause) {
      mark(step, !done);
      setError(`Шаг ${step} не сохранён: ${errorText(cause)}`);
      if ((cause as { status?: number }).status === 409) onConflict();
    } finally {
      setSaving((current) => current.filter((value) => value !== step));
    }
  }

  return <section className="c-block c-checklist" aria-labelledby="c-checklist-title">
    <div className="c-block-title"><h2 id="c-checklist-title">Чек-лист доставки</h2>
      <strong>{progress.done} из {progress.total}</strong></div>
    <div className="c-checklist-bar" role="progressbar" aria-label="Выполнено шагов" aria-valuemin={0}
      aria-valuemax={progress.total} aria-valuenow={progress.done}>
      <span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
    <ol className="c-checklist-steps">
      {CHECKLIST_STEPS.map((item) => {
        const done = isStepDone(view, item.step);
        const current = progress.next?.step === item.step;
        const className = `c-check${done ? ' done' : ''}${current ? ' current' : ''}`;
        const text = <span className="c-check-text"><strong>{item.title}</strong><small>{item.hint}</small></span>;
        if (item.pharmacy) {
          // Step 3: derived from the pharmacy answers, never ticked by hand.
          const answered = answersProgressText(order);
          return <li key={item.step} className={className} aria-current={current ? 'step' : undefined}>
            <div className="c-check-row">
              <span className="c-check-mark" aria-hidden="true">{done ? '✓' : item.step}</span>
              {text}
              {done ? <span className="sr-only">Выполнено</span>
                : answered && <span className="c-check-badge">{answered.replace('Ответ аптек: ', '')}</span>}
            </div>
          </li>;
        }
        if (item.status) {
          const linked = item.status;
          const unconfirmed = item.step === 4 && !done && order.status === 'pending' && !isAmountConfirmed(order);
          return <li key={item.step} className={className} aria-current={current ? 'step' : undefined}>
            <div className="c-check-row">
              <span className="c-check-mark" aria-hidden="true">{done ? '✓' : item.step}</span>
              {text}
              {done ? <span className="sr-only">Выполнено</span>
                : order.status === linked.from && <button type="button" className="c-btn c-btn-outline c-check-action"
                  disabled={statusBusy} onClick={() => onStatus(linked.to)}>{statusBusy ? '…' : linked.action}</button>}
            </div>
            {unconfirmed && <p className="c-check-warning" role="note">Сумма ещё не подтверждена аптекой</p>}
          </li>;
        }
        return <li key={item.step} className={className} aria-current={current ? 'step' : undefined}>
          <label className="c-check-row">
            <input type="checkbox" className="c-check-input" checked={done} disabled={saving.includes(item.step)}
              onChange={(event) => toggle(item.step, event.target.checked)} />
            <span className="c-check-mark" aria-hidden="true">{done ? '✓' : item.step}</span>
            {text}
          </label>
          {item.step === 1 && <a className="c-check-link" href="#courier-fee">К полю «Мне за доставку» ↓</a>}
        </li>;
      })}
    </ol>
    {error && <p className="c-error" role="alert">{error}</p>}
  </section>;
}

export default function CourierOrderDetail({ order }: { order: CourierOrder }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const base = `/api/staff/orders/${encodeURIComponent(order.order_id)}`;
  const step = nextStep[order.status];
  const refresh = () => router.refresh();

  async function changeStatus(next: CourierOrderStatus, cancelReason?: string) {
    setBusy(true); setError('');
    try {
      await send(`${base}/status`, 'PATCH', { status: next, expected_current_status: order.status,
        ...(cancelReason ? { reason: cancelReason } : {}) });
      setCancelling(false); setReason(''); refresh();
    } catch (cause) {
      if ((cause as { status?: number }).status === 409) { refresh(); setError('Статус уже изменился — экран обновлён.'); }
      else setError(errorText(cause));
    } finally { setBusy(false); }
  }

  return <section className="c-page c-detail">
    <Link href="/staff/orders" className="c-back">← Все заказы</Link>
    <header className="c-detail-head">
      <div><h1>№ {order.order_reference || order.order_id.slice(-6)}</h1>
        <p className="c-muted">{formatOrderDateTime(order.created_at)} · Аптека {order.pharmacy_id ?? 1} · {order.own_order ? 'ваш заказ' : 'с сайта'}</p></div>
      <span className={`c-pill c-pill-${order.status}`}>{statusLabels[order.status]}</span>
    </header>
    <Progress status={order.status} />
    <ChecklistSection key={`${order.status}:${(order.checklist_steps ?? []).join(',')}:${order.pharmacy_answers_complete ? 1 : 0}`}
      order={order} base={base}
      statusBusy={busy} onStatus={(next) => changeStatus(next)} onConflict={refresh} />
    <CustomerSection order={order} base={base} onSaved={refresh} />
    <ItemsSection order={order} base={base} onSaved={refresh} />
    {order.status !== 'cancelled' && <FeeSection order={order} base={base} />}
    {error && <p className="c-error" role="alert">{error}</p>}
    {cancelling && <section className="c-block c-cancel">
      <label>Причина отмены<textarea rows={2} maxLength={300} value={reason} autoFocus
        onChange={(event) => setReason(event.target.value)} placeholder="Например: клиент не отвечает" /></label>
      <div className="c-row-actions">
        <button type="button" className="c-btn c-btn-danger" disabled={busy || !reason.trim()}
          onClick={() => changeStatus('cancelled', reason.trim())}>{busy ? '…' : 'Отменить заказ'}</button>
        <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setCancelling(false)}>Назад</button>
      </div>
    </section>}
    {step && !cancelling && <div className="c-action-bar">
      <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => changeStatus(step.status)}>
        {busy ? 'Сохраняем…' : step.label}</button>
      <button type="button" className="c-btn c-btn-ghost" disabled={busy} onClick={() => setCancelling(true)}>Отменить</button>
    </div>}
  </section>;
}

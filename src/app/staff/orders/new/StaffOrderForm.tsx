'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { StaffOrderSource } from '@/lib/api-v1/staff-types';
import { money, parsePrice } from '../../format';
import MedicinePicker, { invalidLine, lineTotal, type PickerLine } from '../MedicinePicker';

const sources: Array<{ value: StaffOrderSource; label: string }> = [
  { value: 'phone', label: 'Звонок' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
];

type Created = { orderId: string; reference: string; notified: boolean };

export default function StaffOrderForm() {
  const [pharmacyId, setPharmacyId] = useState<1 | 2 | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [comment, setComment] = useState('');
  const [source, setSource] = useState<StaffOrderSource | null>(null);
  const [lines, setLines] = useState<PickerLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const pending = useRef<{ payload: string; key: string } | null>(null);

  function reset() {
    setPharmacyId(null); setPhone(''); setName(''); setAddress(''); setLandmark(''); setComment('');
    setSource(null); setLines([]); setError(''); setCreated(null); pending.current = null;
  }

  function problem(): string | null {
    if (!pharmacyId) return 'Выберите аптеку';
    if (!/^\d{9}$/.test(phone)) return 'Телефон — 9 цифр после +992';
    if (address.trim().length < 3) return 'Укажите адрес';
    if (landmark.trim().length < 2) return 'Укажите ориентир';
    const broken = invalidLine(lines);
    if (broken) return `Укажите цену: ${broken.medicine_name}`;
    if (!source) return 'Отметьте, откуда пришёл заказ';
    return null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = problem();
    if (issue) { setError(issue); return; }
    setSubmitting(true); setError('');
    const catalog = lines.filter((line) => line.medicine_id !== null);
    const manual = lines.filter((line) => line.medicine_id === null);
    const payload = JSON.stringify({
      pharmacy_id: pharmacyId, phone, customer_name: name.trim(), address: address.trim(), landmark: landmark.trim(),
      ...(comment.trim() ? { comment: comment.trim() } : {}), source,
      items: catalog.map((line) => ({ medicine_id: line.medicine_id, quantity: line.quantity, unit_price: parsePrice(line.price) })),
      ...(manual.length ? { manual_items: manual.map((line) => ({
        medicine_name: line.medicine_name, price: parsePrice(line.price), quantity: line.quantity })) } : {}),
    });
    if (!pending.current || pending.current.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/staff/orders', {
        method: 'POST', body: payload,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message || result?.error || 'Не удалось сохранить заказ');
      setCreated({ orderId: result.data.order_id, reference: result.data.order_reference, notified: result.data.notification_sent === true });
      pending.current = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить заказ');
    } finally { setSubmitting(false); }
  }

  if (created) {
    return <section className="c-page c-done">
      <div className="c-done-icon" aria-hidden="true">✓</div>
      <h1>Заказ № {created.reference} создан</h1>
      <p>{created.notified ? 'Владелец получил уведомление.' : 'Уведомление не отправилось — сообщите владельцу.'}</p>
      <div className="c-done-actions">
        <Link className="c-btn c-btn-primary c-btn-wide" href={`/staff/orders/${created.orderId}`}>Открыть заказ</Link>
        <button type="button" className="c-btn c-btn-outline c-btn-wide" onClick={reset}>Создать ещё заказ</button>
      </div>
    </section>;
  }

  const total = lineTotal(lines);
  return <section className="c-page c-form-page">
    <div className="c-page-head"><h1>Новый заказ</h1></div>
    <form className="c-form" onSubmit={submit} noValidate>
      <fieldset className="c-section">
        <legend><span>1</span> Аптека</legend>
        <div className="c-segment">
          {([1, 2] as const).map((id) => <button key={id} type="button" aria-pressed={pharmacyId === id}
            className={pharmacyId === id ? 'active' : ''} onClick={() => setPharmacyId(id)}>Аптека {id}</button>)}
        </div>
      </fieldset>

      <fieldset className="c-section">
        <legend><span>2</span> Клиент</legend>
        <label>Телефон<div className="c-phone"><b>+992</b><input value={phone} inputMode="numeric" maxLength={9}
          autoComplete="tel-national" placeholder="917123456"
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 9))} /></div></label>
        <label>Имя <small>необязательно</small><input value={name} maxLength={120} autoComplete="off"
          onChange={(event) => setName(event.target.value)} placeholder="Например: Фарход" /></label>
        <label>Адрес<input value={address} maxLength={500} autoComplete="off"
          onChange={(event) => setAddress(event.target.value)} placeholder="Улица, дом, квартира" /></label>
        <label>Ориентир<input value={landmark} maxLength={300} autoComplete="off"
          onChange={(event) => setLandmark(event.target.value)} placeholder="Например: рядом со школой №5" /></label>
      </fieldset>

      <fieldset className="c-section">
        <legend><span>3</span> Товары <small>можно добавить позже</small></legend>
        <MedicinePicker lines={lines} onChange={(next) => { setLines(next); setError(''); }}
          defaultPrice={(medicine) => medicine.base_unit_price} />
      </fieldset>

      <fieldset className="c-section">
        <legend><span>4</span> Откуда заказ</legend>
        <div className="c-segment c-segment-3">
          {sources.map((item) => <button key={item.value} type="button" aria-pressed={source === item.value}
            className={source === item.value ? 'active' : ''} onClick={() => setSource(item.value)}>{item.label}</button>)}
        </div>
        <label>Комментарий <small>необязательно</small><textarea value={comment} rows={2} maxLength={500}
          onChange={(event) => setComment(event.target.value)} placeholder="Что важно знать о заказе" /></label>
      </fieldset>

      <div className="c-submit-bar">
        {error && <p className="c-error" role="alert">{error}</p>}
        <div className="c-submit-row">
          <span className="c-submit-total"><small>Итого</small><strong>{money(total)}</strong></span>
          <button type="submit" className="c-btn c-btn-primary" disabled={submitting}>{submitting ? 'Сохраняем…' : 'Создать заказ'}</button>
        </div>
      </div>
    </form>
  </section>;
}

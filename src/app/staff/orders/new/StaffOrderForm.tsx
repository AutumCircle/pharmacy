'use client';

import { useState } from 'react';
import type { StaffOrderMedicine, StaffOrderSource } from '@/lib/api-v1/staff-types';

const sources: Array<{ value: StaffOrderSource; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Телефонный звонок' },
];

export default function StaffOrderForm({ accountId, username }: { accountId: 1 | 2; username: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const [notificationSent, setNotificationSent] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<StaffOrderMedicine[]>([]);
  const [items, setItems] = useState<Array<StaffOrderMedicine & { quantity: number }>>([]);

  async function searchMedicines() {
    if (query.trim().length < 2) { setError('Введите минимум 2 символа для поиска лекарства'); return; }
    setSearching(true); setError('');
    try {
      const response = await fetch(`/api/staff/order-medicines?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || 'Не удалось выполнить поиск');
      setResults(result.data || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выполнить поиск');
    } finally { setSearching(false); }
  }

  function addMedicine(medicine: StaffOrderMedicine) {
    setItems((current) => current.some((item) => item.medicine_id === medicine.medicine_id)
      ? current : [...current, { ...medicine, quantity: 1 }]);
  }

  const pharmacyTotal = items.reduce(
    (total, item) => total + Number(item.base_unit_price) * item.quantity, 0,
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setError(''); setCreated('');
    const data = new FormData(event.currentTarget);
    const payload = {
      customer_name: String(data.get('customer_name') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      address: String(data.get('address') || '').trim(),
      landmark: String(data.get('landmark') || '').trim(),
      source: String(data.get('source') || ''),
      items: items.map((item) => ({ medicine_id: item.medicine_id, quantity: item.quantity })),
    };
    try {
      const response = await fetch('/api/staff/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || result?.error || 'Не удалось сохранить заказ');
      setCreated(result.data.order_reference);
      setNotificationSent(result.data.notification_sent === true);
      setFormKey((value) => value + 1);
      setItems([]); setResults([]); setQuery('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить заказ');
    } finally { setSubmitting(false); }
  }

  return (
    <section className="staff-order-page">
      <div className="staff-title-row">
        <div><h1>Новый заказ</h1><p>Аптека {accountId} · {username}</p></div>
      </div>
      {created && <div className={notificationSent ? 'staff-order-success' : 'staff-order-warning'}>
        Заказ {created} сохранён. {notificationSent ? 'Владелец получил уведомление.' : 'Уведомление не отправлено — сообщите администратору.'}
      </div>}
      {error && <div className="staff-login-error">{error}</div>}
      <form key={formKey} className="staff-order-form" onSubmit={submit}>
        {accountId === 2 ? (
          <fieldset className="staff-medicine-picker">
            <legend>Лекарства</legend>
            <p>Добавление лекарств в заказ пока недоступно.</p>
          </fieldset>
        ) : (
          <fieldset className="staff-medicine-picker">
            <legend>Лекарства</legend>
            <div className="staff-search">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название лекарства" />
              <button type="button" disabled={searching} onClick={searchMedicines}>{searching ? 'Поиск…' : 'Найти'}</button>
            </div>
            {results.length > 0 && <div className="staff-picker-results">
              {results.map((medicine) => <div key={medicine.medicine_id}>
                <span><strong>{medicine.medicine_name}</strong><small>{Number(medicine.base_unit_price).toFixed(2)} TJS</small></span>
                <button type="button" onClick={() => addMedicine(medicine)} disabled={items.some((item) => item.medicine_id === medicine.medicine_id)}>
                  {items.some((item) => item.medicine_id === medicine.medicine_id) ? 'Добавлено' : 'Добавить'}
                </button>
              </div>)}
            </div>}
            {items.length > 0 && <div className="staff-selected-items">
              <h3>Добавлено в заказ</h3>
              {items.map((item) => <div key={item.medicine_id}>
                <span><strong>{item.medicine_name}</strong><small>{Number(item.base_unit_price).toFixed(2)} TJS × {item.quantity}</small></span>
                <input aria-label={`Количество ${item.medicine_name}`} type="number" min={1} max={99} value={item.quantity} onChange={(event) => {
                  const quantity = Math.min(99, Math.max(1, Number(event.target.value) || 1));
                  setItems((current) => current.map((entry) => entry.medicine_id === item.medicine_id ? { ...entry, quantity } : entry));
                }} />
                <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.medicine_id !== item.medicine_id))}>Убрать</button>
              </div>)}
              <div className="staff-pharmacy-total"><span>Сумма</span><strong>{pharmacyTotal.toFixed(2)} TJS</strong></div>
            </div>}
          </fieldset>
        )}
        <label>Имя клиента<input name="customer_name" maxLength={120} autoComplete="name" /></label>
        <label>Телефон <span>ровно 9 цифр</span><div className="staff-phone"><b>+992</b><input name="phone" required inputMode="numeric" pattern="[0-9]{9}" minLength={9} maxLength={9} placeholder="917123456" autoComplete="tel-national" /></div></label>
        <label>Адрес<input name="address" required minLength={3} maxLength={500} autoComplete="street-address" /></label>
        <label>Ориентир<textarea name="landmark" required minLength={2} maxLength={300} rows={3} placeholder="Например: рядом со школой №…" /></label>
        <fieldset><legend>Откуда поступил заказ</legend><div className="staff-source-options">{sources.map((source) => <label key={source.value}><input type="radio" name="source" value={source.value} required /> <span>{source.label}</span></label>)}</div></fieldset>
        <button className="staff-submit" disabled={submitting} type="submit">{submitting ? 'Сохраняем…' : 'Создать заказ'}</button>
      </form>
    </section>
  );
}

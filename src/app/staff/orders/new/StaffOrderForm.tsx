'use client';

import { useState } from 'react';
import type { StaffOrderSource } from '@/lib/api-v1/staff-types';

const sources: Array<{ value: StaffOrderSource; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Телефонный звонок' },
];

export default function StaffOrderForm({ accountId, username }: { accountId: 1 | 2; username: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const [formKey, setFormKey] = useState(0);

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
    };
    try {
      const response = await fetch('/api/staff/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || result?.error || 'Не удалось сохранить заказ');
      setCreated(result.data.order_reference);
      setFormKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить заказ');
    } finally { setSubmitting(false); }
  }

  return (
    <section className="staff-order-page">
      <div className="staff-title-row">
        <div><h1>Новый заказ</h1><p>Аптека {accountId} · {username}</p></div>
      </div>
      {created && <div className="staff-order-success">Заказ {created} сохранён. Владелец получил уведомление.</div>}
      {error && <div className="staff-login-error">{error}</div>}
      <form key={formKey} className="staff-order-form" onSubmit={submit}>
        <label>Имя клиента <span>необязательно</span><input name="customer_name" maxLength={120} autoComplete="name" /></label>
        <label>Телефон <span>ровно 9 цифр</span><div className="staff-phone"><b>+992</b><input name="phone" required inputMode="numeric" pattern="[0-9]{9}" minLength={9} maxLength={9} placeholder="917123456" autoComplete="tel-national" /></div></label>
        <label>Адрес<input name="address" required minLength={3} maxLength={500} autoComplete="street-address" /></label>
        <label>Ориентир<textarea name="landmark" required minLength={2} maxLength={300} rows={3} placeholder="Например: рядом со школой №…" /></label>
        <fieldset><legend>Откуда поступил заказ</legend><div className="staff-source-options">{sources.map((source) => <label key={source.value}><input type="radio" name="source" value={source.value} required /> <span>{source.label}</span></label>)}</div></fieldset>
        <button className="staff-submit" disabled={submitting} type="submit">{submitting ? 'Сохраняем…' : 'Создать заказ'}</button>
      </form>
    </section>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderCustomer } from '../actions';

export default function OrderCustomerEditor({ orderId, revision, customerName, phone, address, landmark, comment }: {
  orderId: string; revision: number; customerName: string; phone: string; address: string; landmark: string | null; comment: string | null;
}) {
  const router = useRouter();
  const local = phone.replace(/\D/g, '').slice(-9);
  const initial = { customer_name: customerName, phone: local, address, landmark: landmark || '', comment: comment || '' };
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) => setValues((previous) => ({ ...previous, [key]: value }));

  async function submit() {
    setBusy(true); setError('');
    const result = await updateOrderCustomer(orderId, { ...values, landmark: values.landmark.trim() || null,
      comment: values.comment.trim() || null, expected_revision: revision });
    if (result.success) { setEditing(false); router.refresh(); } else setError(result.error);
    setBusy(false);
  }

  if (!editing) {
    return <section className="od-card od-o1">
      <div className="od-card-head"><h2>Клиент</h2>
        <button type="button" className="od-link" onClick={() => { setValues(initial); setError(''); setEditing(true); }}>Изменить</button></div>
      <div className="od-customer">
        <div><strong>{customerName || 'Имя не указано'}</strong>
          {phone ? <a className="od-phone-link" href={`tel:${phone}`}>{phone}</a> : <span>Телефон не указан</span>}</div>
        {phone && <a className="od-call" href={`tel:${phone}`}>Позвонить</a>}
      </div>
      <dl className="od-facts">
        <div><dt>Адрес</dt><dd>{address}</dd></div>
        {landmark && <div><dt>Ориентир</dt><dd>{landmark}</dd></div>}
        <div><dt>Комментарий</dt><dd>{comment || '—'}</dd></div>
      </dl>
    </section>;
  }

  return <section className="od-card od-form od-o1">
    <div className="od-card-head"><h2>Данные клиента</h2></div>
    <label>Имя<input value={values.customer_name} maxLength={120} onChange={(e) => set('customer_name', e.target.value)} disabled={busy} /></label>
    <label>Телефон<div className="od-phone"><b>+992</b><input inputMode="numeric" maxLength={9} value={values.phone}
      onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 9))} disabled={busy} /></div></label>
    <label>Адрес<input value={values.address} maxLength={500} onChange={(e) => set('address', e.target.value)} disabled={busy} /></label>
    <label>Ориентир<input value={values.landmark} maxLength={300} onChange={(e) => set('landmark', e.target.value)} disabled={busy} /></label>
    <label>Комментарий<textarea rows={2} value={values.comment} maxLength={500} onChange={(e) => set('comment', e.target.value)} disabled={busy} /></label>
    {error && <p className="od-error" role="alert">{error}</p>}
    <div className="od-actions">
      <button type="button" className="ao-btn ao-btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      <button type="button" className="ao-btn ao-btn-ghost" onClick={() => setEditing(false)} disabled={busy}>Отмена</button>
    </div>
  </section>;
}

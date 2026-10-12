'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderCustomer } from '../actions';

export default function OrderCustomerEditor({ orderId, revision, customerName, phone, address, landmark, comment }: {
  orderId: string; revision: number; customerName: string; phone: string; address: string; landmark: string | null; comment: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState({ customer_name: customerName, phone, address, landmark: landmark || '', comment: comment || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (key: keyof typeof values, value: string) => setValues((previous) => ({ ...previous, [key]: value }));
  async function submit() {
    setBusy(true); setError('');
    const result = await updateOrderCustomer(orderId, { ...values, landmark: values.landmark.trim() || null,
      comment: values.comment.trim() || null, expected_revision: revision });
    if (result.success) router.refresh(); else setError(result.error);
    setBusy(false);
  }
  return <section style={{ background: 'white', padding: 20, borderRadius: 12, marginBottom: 20 }}>
    <h2 style={{ marginTop: 0 }}>Данные клиента</h2>
    <p style={{ color: '#667085' }}>Дата создания, доставки и история статусов здесь не изменяются.</p>
    <div style={{ display: 'grid', gap: 10, maxWidth: 620 }}>
      <label>Имя<input value={values.customer_name} onChange={(e) => set('customer_name', e.target.value)} disabled={busy} /></label>
      <label>Телефон (9 цифр)<input inputMode="numeric" value={values.phone} onChange={(e) => set('phone', e.target.value)} disabled={busy} /></label>
      <label>Адрес<input value={values.address} onChange={(e) => set('address', e.target.value)} disabled={busy} /></label>
      <label>Ориентир<input value={values.landmark} onChange={(e) => set('landmark', e.target.value)} disabled={busy} /></label>
      <label>Комментарий<textarea value={values.comment} onChange={(e) => set('comment', e.target.value)} disabled={busy} /></label>
      <button type="button" onClick={() => void submit()} disabled={busy}>Сохранить данные клиента</button>
      {error && <small role="alert" style={{ color: '#c62828' }}>{error}</small>}
    </div>
  </section>;
}

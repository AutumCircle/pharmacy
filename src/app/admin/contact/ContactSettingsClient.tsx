'use client';

import { useState } from 'react';
import type { AdminContactSettings } from '@/lib/api-v1/admin-types';
import { formatTajikPhone } from '@/lib/contact-settings';
import { saveDeliveryContactPhone } from './actions';

export default function ContactSettingsClient({ initialSettings }: { initialSettings: AdminContactSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [phone, setPhone] = useState(initialSettings.delivery_contact_phone || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = await saveDeliveryContactPhone(phone);
    if (result.success) {
      setSettings(result.settings);
      setPhone(result.settings.delivery_contact_phone || '');
      setMessage('Номер сохранён и используется на сайте.');
    } else setMessage(`Ошибка: ${result.error}`);
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Контакт по заказам и доставке</h1>
      <p style={{ margin: '0 0 24px', color: '#666', lineHeight: 1.5 }}>
        Этот номер показывается клиенту после оформления заказа и в нижней части сайта.
      </p>
      <form onSubmit={save} style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: 14, padding: 24 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }} htmlFor="delivery-contact-phone">Номер ответственного</label>
        <input id="delivery-contact-phone" type="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+992 00 000 00 00" style={{ width: '100%', maxWidth: 330, padding: 12, border: '1px solid #ddd', borderRadius: 8, fontSize: 16 }} />
        {settings.delivery_contact_phone && <p style={{ color: '#666' }}>Сейчас на сайте: <strong>{formatTajikPhone(settings.delivery_contact_phone)}</strong></p>}
        {message && <p role="status" style={{ color: message.startsWith('Ошибка') ? '#b42318' : '#166534' }}>{message}</p>}
        <button disabled={busy} type="submit" style={{ marginTop: 8, padding: '12px 22px' }}>{busy ? 'Сохраняем…' : 'Сохранить номер'}</button>
      </form>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { AdminNotificationSettings, NotificationChannel, NotificationField } from '@/lib/api-v1/admin-types';
import { saveNotificationSettings } from './actions';

const channels: Array<{ key: NotificationChannel; label: string }> = [
  { key: 'owner_telegram', label: 'Владелец · Telegram' },
  { key: 'courier_telegram', label: 'Курьер · Telegram' },
  { key: 'pharmacy_telegram', label: 'Аптека 1 · Telegram' },
  { key: 'pharmacy_web', label: 'Аптека 1 · веб-панель' },
];
const fields: Array<{ key: NotificationField; label: string }> = [
  { key: 'order_reference', label: 'Номер заказа' },
  { key: 'created_at', label: 'Дата и время' },
  { key: 'source', label: 'Источник заказа' },
  { key: 'customer_name', label: 'Имя клиента' },
  { key: 'phone', label: 'Телефон' },
  { key: 'address', label: 'Адрес' },
  { key: 'landmark', label: 'Ориентир' },
  { key: 'comment', label: 'Комментарий' },
  { key: 'items', label: 'Товары' },
  { key: 'quantity', label: 'Количество каждого товара' },
  { key: 'item_client_total', label: 'Цена каждой позиции для клиента' },
  { key: 'item_base_total', label: 'Базовая цена каждой позиции' },
  { key: 'client_total', label: 'Клиентская сумма' },
  { key: 'base_total', label: 'Базовая сумма аптеки' },
  { key: 'profit', label: 'Прибыль / разница' },
  { key: 'creator', label: 'Кем создан заказ' },
  { key: 'status', label: 'Текущий статус' },
];

export default function NotificationSettingsClient({ initialSettings }: { initialSettings: AdminNotificationSettings }) {
  const [saved, setSaved] = useState(initialSettings);
  const [draft, setDraft] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  function toggle(channel: NotificationChannel, field: NotificationField) {
    if (field === 'order_reference') return;
    setDraft((value) => ({ ...value, policies: {
      ...value.policies, [channel]: { ...value.policies[channel], [field]: !value.policies[channel][field] },
    } }));
    setMessage('');
  }

  function toggleCourier() {
    if (draft.courier_enabled && !window.confirm('Отключить все Telegram-уведомления курьеру? Старые события после повторного включения не отправятся.')) return;
    setDraft((value) => ({ ...value, courier_enabled: !value.courier_enabled }));
    setMessage('');
  }

  async function save() {
    setBusy(true); setMessage('');
    const result = await saveNotificationSettings({
      courier_enabled: draft.courier_enabled, policies: draft.policies, revision: saved.revision,
    });
    if (result.success) {
      setSaved(result.settings); setDraft(result.settings);
      setMessage('Настройки сохранены. Новые события будут использовать их сразу.');
    } else setMessage(`Ошибка: ${result.error}`);
    setBusy(false);
  }

  return <div className="notification-settings-page">
    <h1>Настройки уведомлений и отображения заказа</h1>
    <p>Выберите, какие данные увидит каждый получатель. Номер заказа всегда показывается. Telegram для аптеки 1 работает только при подключённом отдельном чате. Telegram-токены и адресаты здесь не отображаются.</p>
    <section className={`notification-courier-switch${draft.courier_enabled ? ' enabled' : ' disabled'}`}>
      <div><strong>Уведомления курьеру: {draft.courier_enabled ? 'ВКЛ' : 'ВЫКЛ'}</strong>
        <p>{draft.courier_enabled ? 'Новые заказы могут отправляться курьеру.' : 'Никакие Telegram-сообщения курьеру не отправляются.'}</p></div>
      <button type="button" onClick={toggleCourier} disabled={busy}>{draft.courier_enabled ? 'Выключить' : 'Включить'}</button>
    </section>
    <div className="notification-settings-desktop">
      <table><thead><tr><th>Поле заказа</th>{channels.map((channel) => <th key={channel.key}>{channel.label}</th>)}</tr></thead>
        <tbody>{fields.map((field) => <tr key={field.key}><th scope="row">{field.label}</th>
          {channels.map((channel) => <td key={channel.key}>
            <input type="checkbox" aria-label={`${field.label}: ${channel.label}`} checked={draft.policies[channel.key][field.key]}
              disabled={field.key === 'order_reference' || busy} onChange={() => toggle(channel.key, field.key)} />
          </td>)}</tr>)}</tbody></table>
    </div>
    <div className="notification-settings-mobile">{channels.map((channel) => <section key={channel.key}>
      <h2>{channel.label}</h2>
      {fields.map((field) => <label key={field.key}><span>{field.label}</span>
        <input type="checkbox" checked={draft.policies[channel.key][field.key]}
          disabled={field.key === 'order_reference' || busy} onChange={() => toggle(channel.key, field.key)} />
      </label>)}
    </section>)}</div>
    <div className="notification-settings-actions"><button type="button" disabled={busy} onClick={save}>
      {busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
      <button type="button" disabled={busy} onClick={() => { setDraft(saved); setMessage('Изменения отменены.'); }}>Сбросить изменения</button></div>
    {message && <p role="status" className={message.startsWith('Ошибка') ? 'error' : 'success'}>{message}</p>}
    <small>Последнее изменение: {saved.updated_at ? new Date(saved.updated_at).toLocaleString('ru-RU') : 'по умолчанию'}{saved.updated_by ? ` · ${saved.updated_by}` : ''}</small>
  </div>;
}

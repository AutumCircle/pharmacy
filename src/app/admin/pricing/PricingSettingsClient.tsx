'use client';

import { useMemo, useState } from 'react';
import type { AdminPricingSettings } from '@/lib/api-v1/admin-types';
import { savePricingSettings } from './actions';

export default function PricingSettingsClient({ initialSettings }: { initialSettings: AdminPricingSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [enabled, setEnabled] = useState(initialSettings.markup_enabled);
  const [percent, setPercent] = useState(String(initialSettings.markup_percent));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const examplePrice = useMemo(() => {
    const parsed = Number(percent);
    if (!Number.isFinite(parsed)) return null;
    return Math.ceil(100 * (enabled ? 1 + parsed / 100 : 1));
  }, [enabled, percent]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = Number(percent);
    setBusy(true);
    setMessage('');
    const response = await savePricingSettings(enabled, parsed);
    if (response.success) {
      setSettings(response.settings);
      setPercent(String(response.settings.markup_percent));
      setMessage('Настройки цены сохранены. Новые цены уже применяются в каталоге и новых заказах.');
    } else {
      setMessage(`Ошибка: ${response.error}`);
    }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Настройка цен</h1>
      <p style={{ margin: '0 0 24px', color: '#666', lineHeight: 1.5 }}>
        Наценка применяется к базовой цене из DBF. Цена продажи округляется вверх до целого сомони.
        Уже созданные заказы и их сохранённые цены не изменяются.
      </p>

      <form onSubmit={save} style={{ background: 'white', border: '1px solid #e5e5e5', borderRadius: 14, padding: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, paddingBottom: 20, borderBottom: '1px solid #eee' }}>
          <span>
            <strong style={{ display: 'block', marginBottom: 5 }}>Использовать наценку</strong>
            <small style={{ color: '#777' }}>{enabled ? 'Включена' : 'Выключена — используется базовая цена'}</small>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            style={{ width: 22, height: 22 }}
          />
        </label>

        <label style={{ display: 'block', marginTop: 22 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Процент наценки</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 260 }}>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              required
              disabled={!enabled}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16 }}
            />
            <strong>%</strong>
          </div>
        </label>

        <div style={{ marginTop: 22, padding: 16, background: '#f7f7f7', borderRadius: 10 }}>
          <div style={{ color: '#666', fontSize: 13, marginBottom: 5 }}>Пример для базовой цены 100 сомони</div>
          <strong style={{ fontSize: 22 }}>{examplePrice === null ? '—' : `${examplePrice} с.`}</strong>
        </div>

        {message && <p role="status" style={{ color: message.startsWith('Ошибка') ? '#b42318' : '#166534', marginBottom: 0 }}>{message}</p>}

        <button disabled={busy} type="submit" style={{ marginTop: 22, padding: '12px 22px' }}>
          {busy ? 'Сохраняем…' : 'Сохранить настройки'}
        </button>
      </form>

      <p style={{ marginTop: 14, color: '#888', fontSize: 13 }}>
        Последнее изменение: {new Date(settings.updated_at).toLocaleString('ru-RU')}
        {settings.updated_by ? ` · ${settings.updated_by}` : ''}
      </p>
    </div>
  );
}

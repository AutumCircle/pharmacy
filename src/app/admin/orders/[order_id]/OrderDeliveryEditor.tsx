'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderDelivery } from '../actions';

type Mode = 'courier' | 'me' | 'split';

const modes: Array<{ value: Mode; label: string; hint: string }> = [
  { value: 'courier', label: 'Курьер', hint: 'Всю сумму получил курьер' },
  { value: 'me', label: 'Мне', hint: 'Доставил я, деньги получил я' },
  { value: 'split', label: 'Поделить', hint: 'Часть курьеру, часть мне' },
];

const toNumber = (value: string) => Number(value.replace(',', '.')) || 0;
const money = (value: number) => value.toFixed(2);

export default function OrderDeliveryEditor({ orderId, courierAmount, ownerAmount, currency }: {
  orderId: string; courierAmount: number; ownerAmount: number; currency: string;
}) {
  const router = useRouter();
  const initialMode: Mode = ownerAmount === 0 ? 'courier' : courierAmount === 0 ? 'me' : 'split';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [fee, setFee] = useState(money(courierAmount + ownerAmount));
  const [mine, setMine] = useState(money(ownerAmount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const total = toNumber(fee);
  const ownerPart = mode === 'courier' ? 0 : mode === 'me' ? total : Math.min(toNumber(mine), total);
  const courierPart = Math.round((total - ownerPart) * 100) / 100;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'split' && toNumber(mine) > total) {
      setError('Ваша часть больше общей суммы доставки');
      return;
    }
    setSaving(true); setError(null); setSaved(false);
    const result = await updateOrderDelivery(orderId, courierPart, ownerPart);
    if (result.success) { setSaved(true); router.refresh(); } else setError(result.error);
    setSaving(false);
  };

  const change = (action: () => void) => { setSaved(false); action(); };

  return (
    <form onSubmit={submit} style={{ background: 'white', padding: 20, borderRadius: 12, marginBottom: 20, maxWidth: 560 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }} htmlFor="delivery-fee">Сумма доставки</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <input id="delivery-fee" type="number" inputMode="decimal" min="0" max="1000000" step="0.01" required value={fee}
          onChange={(event) => change(() => setFee(event.target.value))}
          style={{ width: 140, minHeight: 42, border: '1px solid #d0d5dd', borderRadius: 8, padding: '6px 10px', font: 'inherit' }} />
        <span>{currency === 'TJS' ? 'с.' : currency}</span>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 6 }}>Кто получил деньги</div>
      <div role="radiogroup" aria-label="Кто получил деньги за доставку" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {modes.map((item) => (
          <button key={item.value} type="button" role="radio" aria-checked={mode === item.value}
            onClick={() => change(() => setMode(item.value))}
            style={{
              flex: '1 1 120px', minHeight: 44, borderRadius: 10, font: 'inherit', cursor: 'pointer',
              border: mode === item.value ? '2px solid #1b7f35' : '1px solid #d0d5dd',
              background: mode === item.value ? '#eef8f0' : 'white', fontWeight: mode === item.value ? 700 : 400,
            }}>{item.label}</button>
        ))}
      </div>
      <small style={{ display: 'block', color: '#666', margin: '6px 0 14px' }}>{modes.find((item) => item.value === mode)?.hint}</small>

      {mode === 'split' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <label htmlFor="delivery-mine">Моя часть</label>
          <input id="delivery-mine" type="number" inputMode="decimal" min="0" max={total} step="0.01" value={mine}
            onChange={(event) => change(() => setMine(event.target.value))}
            style={{ width: 120, minHeight: 42, border: '1px solid #d0d5dd', borderRadius: 8, padding: '6px 10px', font: 'inherit' }} />
          <span>с.</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div style={{ padding: 12, borderRadius: 10, background: '#f3f5f8' }}><div style={{ color: '#606873' }}>Курьеру</div><strong style={{ fontSize: 20 }}>{money(courierPart)} с.</strong></div>
        <div style={{ padding: 12, borderRadius: 10, background: '#eef8f0' }}><div style={{ color: '#55705b' }}>Мне</div><strong style={{ fontSize: 20, color: '#1b7f35' }}>{money(ownerPart)} с.</strong></div>
      </div>

      <button type="submit" className="admin-primary-button" disabled={saving} style={{ minHeight: 42, padding: '8px 18px' }}>{saving ? 'Сохранение…' : 'Сохранить доставку'}</button>
      {saved && <span role="status" style={{ marginLeft: 12, color: '#1b7f35' }}>Сохранено</span>}
      {error && <small role="alert" style={{ display: 'block', marginTop: 8, color: '#c62828' }}>{error}</small>}
    </form>
  );
}

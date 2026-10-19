'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateOrderDelivery } from '../actions';

type Mode = 'courier' | 'me' | 'split';

const modes: Array<{ value: Mode; label: string; hint: string }> = [
  { value: 'courier', label: 'Курьер', hint: 'Доставил курьер, деньги за доставку у него' },
  { value: 'me', label: 'Я', hint: 'Доставили вы, деньги за доставку ваши' },
  { value: 'split', label: 'Поделить', hint: 'Часть курьеру, часть вам' },
];

const toNumber = (value: string) => Number(value.replace(',', '.')) || 0;
const fmt = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с.`;

export default function OrderDeliveryEditor({ orderId, courierAmount, ownerAmount }: {
  orderId: string; courierAmount: number; ownerAmount: number; currency?: string;
}) {
  const router = useRouter();
  const initialMode: Mode = ownerAmount === 0 ? 'courier' : courierAmount === 0 ? 'me' : 'split';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [fee, setFee] = useState(String(courierAmount + ownerAmount || ''));
  const [mine, setMine] = useState(String(ownerAmount || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const total = toNumber(fee);
  const ownerPart = mode === 'courier' ? 0 : mode === 'me' ? total : Math.min(toNumber(mine), total);
  const courierPart = Math.round((total - ownerPart) * 100) / 100;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (total < 0 || total > 1_000_000) { setError('Сумма доставки — от 0 до 1 000 000'); return; }
    if (mode === 'split' && toNumber(mine) > total) { setError('Ваша часть больше общей суммы доставки'); return; }
    setSaving(true); setError(null); setSaved(false);
    const result = await updateOrderDelivery(orderId, courierPart, ownerPart);
    if (result.success) { setSaved(true); router.refresh(); } else setError(result.error);
    setSaving(false);
  };
  const change = (action: () => void) => { setSaved(false); action(); };

  return <form onSubmit={submit} className="od-card od-delivery od-o4">
    <div className="od-card-head"><h2>Доставка</h2></div>
    <label className="od-field"><span>Сумма доставки</span>
      <span className="mp-money"><input inputMode="decimal" value={fee} placeholder="0"
        onChange={(event) => change(() => setFee(event.target.value))} /><span>с.</span></span></label>
    <div className="od-field"><span>Кто доставил</span>
      <div className="od-segment" role="radiogroup" aria-label="Кто доставил и получил деньги за доставку">
        {modes.map((item) => <button key={item.value} type="button" role="radio" aria-checked={mode === item.value}
          className={mode === item.value ? 'active' : ''} onClick={() => change(() => setMode(item.value))}>{item.label}</button>)}
      </div>
      <small>{modes.find((item) => item.value === mode)?.hint}</small>
    </div>
    {mode === 'split' && <label className="od-field"><span>Ваша часть</span>
      <span className="mp-money"><input inputMode="decimal" value={mine} placeholder="0"
        onChange={(event) => change(() => setMine(event.target.value))} /><span>с.</span></span></label>}
    <div className="od-split">
      <div><span>Курьеру</span><strong>{fmt(courierPart)}</strong></div>
      <div className="mine"><span>Вам</span><strong>{fmt(ownerPart)}</strong></div>
    </div>
    {error && <p className="od-error" role="alert">{error}</p>}
    <div className="od-actions">
      <button type="submit" className="ao-btn ao-btn-primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить доставку'}</button>
      {saved && <span className="od-saved" role="status">Сохранено ✓</span>}
    </div>
  </form>;
}

'use client';

import { useRef, useState } from 'react';
import type { StaffOrderMedicine, StaffOrderSource } from '@/lib/api-v1/staff-types';

const sources: Array<{ value: StaffOrderSource; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Телефонный звонок' },
];

export default function StaffOrderForm({ accountId, username }: { accountId: 1 | 2 | 3; username: string }) {
  const isCourier = accountId === 3;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const [notificationSent, setNotificationSent] = useState(true);
  const [formKey, setFormKey] = useState(0);
  const [pharmacyId, setPharmacyId] = useState<1 | 2 | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<StaffOrderMedicine[]>([]);
  const [items, setItems] = useState<Array<StaffOrderMedicine & { quantity: number }>>([]);
  const [manualItems, setManualItems] = useState<Array<{ medicine_name: string; price: string; quantity: number }>>([]);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualQuantity, setManualQuantity] = useState(1);
  const pendingRequest = useRef<{ payload: string; key: string } | null>(null);

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

  function addManualMedicine() {
    const price = manualPrice.replace(',', '.').trim();
    if (manualName.trim().length < 2 || manualName.trim().length > 200 ||
      !/^\d{1,6}(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0 ||
      !Number.isInteger(manualQuantity) || manualQuantity < 1 || manualQuantity > 99) {
      setError('Проверьте название, цену и количество'); return;
    }
    if (manualItems.length >= 20) { setError('Не более 20 ручных позиций'); return; }
    setManualItems((current) => [...current, { medicine_name: manualName.trim(), price, quantity: manualQuantity }]);
    setManualName(''); setManualPrice(''); setManualQuantity(1); setError('');
  }

  const pharmacyTotal = items.reduce(
    (total, item) => total + Number(item.base_unit_price) * item.quantity, 0,
  ) + manualItems.reduce((total, item) => total + Number(item.price) * item.quantity, 0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (manualName.trim() || manualPrice.trim()) {
      setError('Нажмите «+ Добавить» для ручного лекарства перед созданием заказа'); return;
    }
    setSubmitting(true); setError(''); setCreated('');
    const data = new FormData(event.currentTarget);
    const payload = {
      customer_name: String(data.get('customer_name') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      address: String(data.get('address') || '').trim(),
      landmark: String(data.get('landmark') || '').trim(),
      comment: String(data.get('comment') || '').trim(),
      source: String(data.get('source') || ''),
      items: items.map((item) => ({ medicine_id: item.medicine_id, quantity: item.quantity })),
      ...(manualItems.length ? { manual_items: manualItems } : {}),
      ...(isCourier ? { pharmacy_id: Number(data.get('pharmacy_id')) } : {}),
    };
    const serialized = JSON.stringify(payload);
    if (!pendingRequest.current || pendingRequest.current.payload !== serialized) {
      pendingRequest.current = { payload: serialized, key: crypto.randomUUID() };
    }
    try {
      const response = await fetch('/api/staff/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pendingRequest.current.key },
        body: serialized,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || result?.error || 'Не удалось сохранить заказ');
      setCreated(result.data.order_reference);
      pendingRequest.current = null;
      setNotificationSent(result.data.notification_sent === true);
      setFormKey((value) => value + 1);
      setItems([]); setManualItems([]); setResults([]); setQuery(''); setPharmacyId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить заказ');
    } finally { setSubmitting(false); }
  }

  return (
    <section className="staff-order-page">
      <div className="staff-title-row">
        <div><h1>Новый заказ</h1><p>{isCourier ? `Доставщик · ${username}` : `Аптека ${accountId} · ${username}`}</p></div>
      </div>
      {created && <div className={notificationSent ? 'staff-order-success' : 'staff-order-warning'}>
        Заказ {created} сохранён. {notificationSent ? 'Владелец получил уведомление.' : 'Уведомление не отправлено — сообщите администратору.'}
      </div>}
      {error && <div className="staff-login-error">{error}</div>}
      <form key={formKey} className="staff-order-form" onSubmit={submit}>
        {isCourier && <label>Аптека
          <select name="pharmacy_id" required value={pharmacyId ?? ''} onChange={(event) => {
            const selected = Number(event.target.value) as 1 | 2;
            setPharmacyId(selected); setItems([]); setManualItems([]); setResults([]); setQuery('');
          }}>
            <option value="" disabled>Выберите аптеку</option>
            <option value="1">Аптека 1</option>
            <option value="2">Аптека 2</option>
          </select>
        </label>}
        {pharmacyId === 2 ? (
          <fieldset className="staff-medicine-picker">
            <legend>Лекарства</legend>
            <p>Найдите название в общем каталоге, затем введите цену аптеки 2 ниже. Цена аптеки 1 не используется.</p>
            <div className="staff-search">
              <input aria-label="Название лекарства для поиска" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название лекарства" />
              <button type="button" disabled={searching || query.trim().length < 2} onClick={searchMedicines}>{searching ? 'Поиск…' : 'Найти'}</button>
            </div>
            {results.length > 0 && <div className="staff-picker-results">{results.map((medicine) => <div key={medicine.medicine_id}>
              <span><strong>{medicine.medicine_name}</strong></span>
              <button type="button" onClick={() => { setManualName(medicine.medicine_name); setManualPrice(''); setError(''); }}>
                Указать свою цену
              </button>
            </div>)}</div>}
          </fieldset>
        ) : pharmacyId === 1 ? (
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
        ) : null}
        {pharmacyId !== null && <fieldset className="staff-medicine-picker">
          <legend>Лекарство вне каталога</legend>
          <p>Ручная позиция сохраняется только в заказе · цена без наценки</p>
          <div className="staff-manual-entry">
            <input aria-label="Название лекарства вне каталога" placeholder="Название лекарства" maxLength={200}
              value={manualName} onChange={(event) => setManualName(event.target.value)} />
            <input aria-label="Цена лекарства в сомони" type="number" inputMode="decimal" min="0.01" max="999999.99" step="0.01"
              placeholder="Цена, с." value={manualPrice} onChange={(event) => setManualPrice(event.target.value)} />
            <input aria-label="Количество лекарства" type="number" min={1} max={99} value={manualQuantity}
              onChange={(event) => setManualQuantity(Number(event.target.value))} />
            <button type="button" onClick={addManualMedicine}>+ Добавить</button>
          </div>
          {manualItems.length > 0 && <div className="staff-selected-items">
            {manualItems.map((item, index) => <div key={`${item.medicine_name}-${index}`}>
              <span><strong>{item.medicine_name}</strong><small>{Number(item.price).toFixed(2)} с. × {item.quantity}</small></span>
              <button type="button" onClick={() => setManualItems((current) => current.filter((_, position) => position !== index))}>Убрать</button>
            </div>)}
            <div className="staff-pharmacy-total"><span>Сумма лекарств</span><strong>{pharmacyTotal.toFixed(2)} с.</strong></div>
          </div>}
        </fieldset>}
        <label>Имя клиента<input name="customer_name" maxLength={120} autoComplete="name" /></label>
        <label>Телефон <span>ровно 9 цифр</span><div className="staff-phone"><b>+992</b><input name="phone" required inputMode="numeric" pattern="[0-9]{9}" minLength={9} maxLength={9} placeholder="917123456" autoComplete="tel-national" /></div></label>
        <label>Адрес<input name="address" required minLength={3} maxLength={500} autoComplete="street-address" /></label>
        <label>Ориентир<textarea name="landmark" required minLength={2} maxLength={300} rows={3} placeholder="Например: рядом со школой №…" /></label>
        <label>Комментарий к заказу<textarea name="comment" maxLength={500} rows={3} placeholder="Что важно знать о заказе или доставке" /></label>
        <fieldset><legend>Откуда поступил заказ</legend><div className="staff-source-options">{sources.map((source) => <label key={source.value}><input type="radio" name="source" value={source.value} required /> <span>{source.label}</span></label>)}</div></fieldset>
        <button className="staff-submit" disabled={submitting} type="submit">{submitting ? 'Сохраняем…' : 'Создать заказ'}</button>
      </form>
    </section>
  );
}

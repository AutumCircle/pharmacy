'use client';

import { useState } from 'react';
import type { AdminFeaturedProduct, AdminMedicine } from '@/lib/api-v1/admin-types';
import { addFeaturedProduct, removeFeaturedProduct, saveFeaturedProduct, searchFeaturedCandidates } from './actions';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #ddd',
  borderRadius: 8,
  boxSizing: 'border-box',
};

export default function FeaturedProductsClient({ initialProducts }: { initialProducts: AdminFeaturedProduct[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminMedicine[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const response = await searchFeaturedCandidates(query);
    if (response.success) setResults(response.items);
    else setMessage(response.error);
    setBusy(false);
  };

  const add = async (medicineId: number) => {
    setBusy(true);
    const nextOrder = products.reduce((maximum, product) => Math.max(maximum, product.sort_order), 0) + 10;
    const response = await addFeaturedProduct(medicineId, nextOrder);
    if (response.success) {
      setProducts((current) => [...current.filter((item) => item.medicine_id !== medicineId), response.product]
        .sort((left, right) => left.sort_order - right.sort_order));
      setResults([]);
      setQuery('');
      setMessage('Товар добавлен');
    } else setMessage(response.error);
    setBusy(false);
  };

  const change = <K extends 'image_url' | 'sort_order'>(medicineId: number, field: K, value: AdminFeaturedProduct[K]) => {
    setProducts((current) => current.map((product) => product.medicine_id === medicineId
      ? { ...product, [field]: value }
      : product));
  };

  const save = async (product: AdminFeaturedProduct) => {
    setBusy(true);
    const response = await saveFeaturedProduct(product.medicine_id, product.image_url || '', product.sort_order);
    if (response.success) {
      setProducts((current) => current.map((item) => item.medicine_id === product.medicine_id ? response.product : item)
        .sort((left, right) => left.sort_order - right.sort_order));
      setMessage('Изменения сохранены');
    } else setMessage(response.error);
    setBusy(false);
  };

  const remove = async (medicineId: number) => {
    if (!confirm('Убрать лекарство из раздела «Товары дня»? Само лекарство не удаляется.')) return;
    setBusy(true);
    const response = await removeFeaturedProduct(medicineId);
    if (response.success) {
      setProducts((current) => current.filter((item) => item.medicine_id !== medicineId));
      setMessage('Товар убран из карусели');
    } else setMessage(response.error);
    setBusy(false);
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Товары дня</h1>
      <p style={{ margin: '0 0 24px', color: '#666' }}>
        Добавляйте товары по medicine_id. Цена и наличие обновляются автоматически из каталога.
      </p>

      <section style={{ background: 'white', padding: 20, borderRadius: 12, border: '1px solid #e8e8e8', marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>Добавить лекарство</h2>
        <form onSubmit={search} style={{ display: 'flex', gap: 10 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или medicine_id" style={inputStyle} />
          <button type="submit" disabled={busy} style={{ padding: '0 18px' }}>Найти</button>
        </form>
        {results.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            {results.map((medicine) => {
              const alreadyAdded = products.some((product) => product.medicine_id === medicine.medicine_id);
              return (
                <div key={medicine.medicine_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', padding: 12, background: '#f8f8f8', borderRadius: 8 }}>
                  <div>
                    <strong>{medicine.medicine_name}</strong>
                    <small style={{ display: 'block', color: '#777', marginTop: 3 }}>
                      ID {medicine.medicine_id} · {medicine.selling_unit_price} с. · {medicine.in_stock ? 'в наличии' : 'нет в наличии'}
                    </small>
                  </div>
                  <button type="button" disabled={busy || alreadyAdded} onClick={() => add(medicine.medicine_id)}>
                    {alreadyAdded ? 'Добавлен' : 'Добавить'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {message && <p style={{ color: message.includes('Ошибка') ? '#b42318' : '#166534' }}>{message}</p>}

      <div style={{ display: 'grid', gap: 16 }}>
        {products.map((product) => (
          <article key={product.medicine_id} style={{ display: 'grid', gridTemplateColumns: '120px minmax(220px, 1fr) minmax(240px, 1.5fr) 110px auto', gap: 18, alignItems: 'center', background: 'white', border: '1px solid #e8e8e8', borderRadius: 12, padding: 16 }}>
            <div style={{ width: 120, height: 100, background: '#f7f7f7', borderRadius: 9, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              {product.image_url ? (
                // Admin API accepts only HTTPS image URLs.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image_url} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : <span style={{ color: '#999', fontSize: 12 }}>Нет картинки</span>}
            </div>
            <div>
              <strong>{product.medicine_name}</strong>
              <small style={{ display: 'block', color: '#777', marginTop: 5 }}>
                ID {product.medicine_id} · {product.selling_unit_price} с. · {product.in_stock ? 'в наличии' : 'не показывается: нет в наличии'}
              </small>
            </div>
            <label>
              <span style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>HTTPS-ссылка на изображение</span>
              <input value={product.image_url || ''} onChange={(event) => change(product.medicine_id, 'image_url', event.target.value)} placeholder="https://..." style={inputStyle} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>Порядок</span>
              <input type="number" min={0} max={100000} value={product.sort_order} onChange={(event) => change(product.medicine_id, 'sort_order', Number(event.target.value))} style={inputStyle} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={busy} onClick={() => save(product)}>Сохранить</button>
              <button type="button" disabled={busy} onClick={() => remove(product.medicine_id)} style={{ color: '#b42318' }}>Убрать</button>
            </div>
          </article>
        ))}
        {products.length === 0 && <div style={{ background: 'white', padding: 30, borderRadius: 12, color: '#777' }}>Товары дня пока не выбраны.</div>}
      </div>
    </div>
  );
}

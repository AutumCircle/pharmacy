'use client';

import { useState } from 'react';
import type { AdminCarouselProduct, AdminMedicine, AdminProductCarousel } from '@/lib/api-v1/admin-types';
import {
  addCarouselProduct,
  createCarousel,
  removeCarousel,
  removeCarouselProduct,
  saveCarousel,
  saveCarouselProduct,
  searchCarouselCandidates,
} from './actions';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, boxSizing: 'border-box',
};

function ProductPreview({ product }: { product: AdminCarouselProduct }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  return (
    <div style={{ width: 90, height: 76, background: '#f7f7f7', borderRadius: 9, display: 'grid', placeItems: 'center', overflow: 'hidden', flex: '0 0 auto' }}>
      {product.image_url && failedImageUrl !== product.image_url ? (
        // URLs are validated by the admin Lambda and are not privileged uploads.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt={product.medicine_name} onError={() => setFailedImageUrl(product.image_url)} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : <span style={{ color: '#888', fontSize: 11, textAlign: 'center' }}>Нет изображения</span>}
    </div>
  );
}

export default function CarouselsClient({ initialCarousels }: { initialCarousels: AdminProductCarousel[] }) {
  const [carousels, setCarousels] = useState(initialCarousels);
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [queries, setQueries] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, AdminMedicine[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const accept = (response: { success: true; carousels: AdminProductCarousel[] } | { success: false; error: string }, ok: string) => {
    if (response.success) {
      setCarousels(response.carousels);
      setMessage(ok);
    } else setMessage(`Ошибка: ${response.error}`);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const nextOrder = carousels.reduce((max, item) => Math.max(max, item.sort_order), 0) + 10;
    const response = await createCarousel(newSlug, newTitle, nextOrder);
    accept(response, 'Карусель создана');
    if (response.success) { setNewSlug(''); setNewTitle(''); }
    setBusy(false);
  };

  const updateCarousel = (id: number, field: 'title' | 'is_active' | 'sort_order', value: string | boolean | number) => {
    setCarousels((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const saveSection = async (carousel: AdminProductCarousel) => {
    setBusy(true);
    accept(await saveCarousel(carousel.id, carousel.title, carousel.is_active, carousel.sort_order), 'Карусель сохранена');
    setBusy(false);
  };

  const deleteSection = async (carousel: AdminProductCarousel) => {
    if (!confirm(`Удалить карусель «${carousel.title}» и её список товаров? Сами лекарства не удаляются.`)) return;
    setBusy(true);
    accept(await removeCarousel(carousel.id), 'Карусель удалена');
    setBusy(false);
  };

  const search = async (event: React.FormEvent, carouselId: number) => {
    event.preventDefault();
    setBusy(true);
    const response = await searchCarouselCandidates(queries[carouselId] || '');
    if (response.success) setResults((current) => ({ ...current, [carouselId]: response.items }));
    else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const addProduct = async (carousel: AdminProductCarousel, medicineId: number) => {
    setBusy(true);
    const nextOrder = carousel.products.reduce((max, item) => Math.max(max, item.sort_order), 0) + 10;
    const response = await addCarouselProduct(carousel.id, medicineId, nextOrder);
    accept(response, 'Товар добавлен');
    if (response.success) setResults((current) => ({ ...current, [carousel.id]: [] }));
    setBusy(false);
  };

  const updateProduct = (carouselId: number, medicineId: number, field: 'image_url' | 'sort_order', value: string | number) => {
    setCarousels((current) => current.map((carousel) => carousel.id !== carouselId ? carousel : {
      ...carousel,
      products: carousel.products.map((product) => product.medicine_id === medicineId ? { ...product, [field]: value } : product),
    }));
  };

  const saveProduct = async (carouselId: number, product: AdminCarouselProduct) => {
    setBusy(true);
    accept(await saveCarouselProduct(carouselId, product.medicine_id, product.sort_order, product.image_url || ''), 'Товар сохранён');
    setBusy(false);
  };

  const deleteProduct = async (carouselId: number, product: AdminCarouselProduct) => {
    if (!confirm(`Убрать «${product.medicine_name}» из этой карусели?`)) return;
    setBusy(true);
    accept(await removeCarouselProduct(carouselId, product.medicine_id), 'Товар убран из карусели');
    setBusy(false);
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Карусели товаров</h1>
      <p style={{ margin: '0 0 24px', color: '#666' }}>Создавайте секции главной страницы и управляйте их товарами. Изображение принадлежит лекарству и используется во всех каруселях.</p>

      <form className="admin-carousel-create" onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 2fr) auto', gap: 12, background: 'white', padding: 18, border: '1px solid #e8e8e8', borderRadius: 12, marginBottom: 20 }}>
        <input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="slug: seasonal-offers" style={inputStyle} />
        <input required minLength={2} maxLength={120} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Название карусели" style={inputStyle} />
        <button disabled={busy} type="submit">Создать</button>
      </form>

      {message && <p role="status" style={{ color: message.startsWith('Ошибка') ? '#b42318' : '#166534' }}>{message}</p>}

      <div style={{ display: 'grid', gap: 22 }}>
        {carousels.map((carousel) => (
          <section key={carousel.id} style={{ background: 'white', border: '1px solid #e4e4e4', borderRadius: 14, padding: 20 }}>
            <div className="admin-carousel-heading" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) 110px auto auto', gap: 12, alignItems: 'end', marginBottom: 18 }}>
              <label><span style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>Название · {carousel.slug}</span><input value={carousel.title} onChange={(event) => updateCarousel(carousel.id, 'title', event.target.value)} style={inputStyle} /></label>
              <label><span style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>Порядок</span><input type="number" min={0} max={100000} value={carousel.sort_order} onChange={(event) => updateCarousel(carousel.id, 'sort_order', Number(event.target.value))} style={inputStyle} /></label>
              <label style={{ paddingBottom: 10 }}><input type="checkbox" checked={carousel.is_active} onChange={(event) => updateCarousel(carousel.id, 'is_active', event.target.checked)} /> Активна</label>
              <div style={{ display: 'flex', gap: 8 }}><button disabled={busy} type="button" onClick={() => saveSection(carousel)}>Сохранить</button><button disabled={busy} type="button" onClick={() => deleteSection(carousel)} style={{ color: '#b42318' }}>Удалить</button></div>
            </div>

            <form onSubmit={(event) => search(event, carousel.id)} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <input value={queries[carousel.id] || ''} onChange={(event) => setQueries((current) => ({ ...current, [carousel.id]: event.target.value }))} placeholder="Найти лекарство по названию или medicine_id" style={inputStyle} />
              <button disabled={busy} type="submit">Найти</button>
            </form>
            {(results[carousel.id] || []).map((medicine) => {
              const duplicate = carousel.products.some((item) => item.medicine_id === medicine.medicine_id);
              return <div key={medicine.medicine_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 10, background: '#f7f7f7', marginBottom: 6, borderRadius: 8 }}><span><strong>{medicine.medicine_name}</strong><small style={{ display: 'block', color: '#777' }}>ID {medicine.medicine_id} · {medicine.selling_unit_price} с.</small></span><button type="button" disabled={busy || duplicate} onClick={() => addProduct(carousel, medicine.medicine_id)}>{duplicate ? 'Уже добавлен' : 'Добавить'}</button></div>;
            })}

            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              {carousel.products.map((product) => (
                <article className="admin-carousel-product-row" key={product.medicine_id} style={{ display: 'grid', gridTemplateColumns: '90px minmax(180px, 1.3fr) minmax(220px, 2fr) 100px auto', gap: 14, alignItems: 'center', padding: 12, border: '1px solid #eee', borderRadius: 10 }}>
                  <ProductPreview product={product} />
                  <div><strong>{product.medicine_name}</strong><small style={{ display: 'block', color: '#777', marginTop: 4 }}>ID {product.medicine_id} · {product.in_stock ? 'в наличии' : 'нет в наличии'}</small></div>
                  <label><span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>HTTPS-ссылка на изображение</span><input type="url" value={product.image_url || ''} onChange={(event) => updateProduct(carousel.id, product.medicine_id, 'image_url', event.target.value)} placeholder="https://..." style={inputStyle} /></label>
                  <label><span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Порядок</span><input type="number" min={0} max={100000} value={product.sort_order} onChange={(event) => updateProduct(carousel.id, product.medicine_id, 'sort_order', Number(event.target.value))} style={inputStyle} /></label>
                  <div style={{ display: 'flex', gap: 7 }}><button disabled={busy} type="button" onClick={() => saveProduct(carousel.id, product)}>Сохранить</button><button disabled={busy} type="button" onClick={() => deleteProduct(carousel.id, product)} style={{ color: '#b42318' }}>Убрать</button></div>
                </article>
              ))}
              {carousel.products.length === 0 && <div style={{ padding: 18, color: '#777', background: '#fafafa', borderRadius: 9 }}>В этой карусели пока нет товаров.</div>}
            </div>
          </section>
        ))}
        {carousels.length === 0 && <div style={{ background: 'white', padding: 30, borderRadius: 12, color: '#777' }}>Карусели ещё не созданы.</div>}
      </div>
    </div>
  );
}

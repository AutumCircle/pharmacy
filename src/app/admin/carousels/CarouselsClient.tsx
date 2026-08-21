'use client';

import { useMemo, useState } from 'react';
import type { AdminCarouselProduct, AdminMedicine, AdminProductCarousel } from '@/lib/api-v1/admin-types';
import {
  addCarouselProduct,
  createCarousel,
  removeCarousel,
  removeCarouselProduct,
  reorderCarouselProducts,
  saveCarousel,
  saveCarouselProduct,
  searchCarouselCandidates,
} from './actions';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, boxSizing: 'border-box',
};

async function optimizeProductImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bitmap.width, 1200 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог обработать изображение');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob || blob.size > 3 * 1024 * 1024) throw new Error('Не удалось подготовить изображение размером до 3 МБ');
  return new File([blob], 'product.webp', { type: 'image/webp' });
}

function ProductPreview({ product }: { product: AdminCarouselProduct }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  return (
    <div style={{ width: 90, height: 76, background: '#f7f7f7', borderRadius: 9, display: 'grid', placeItems: 'center', overflow: 'hidden', flex: '0 0 auto' }}>
      {product.image_url && failedImageUrl !== product.image_url ? (
        // URLs are validated by the admin Lambda and are not privileged uploads.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt={product.medicine_name} onError={() => setFailedImageUrl(product.image_url)} referrerPolicy="no-referrer" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : <span style={{ color: '#888', fontSize: 11, textAlign: 'center' }}>Нет изображения</span>}
    </div>
  );
}

type ActionResponse =
  | { success: true; carousels: AdminProductCarousel[] }
  | { success: false; error: string };

export default function CarouselsClient({ initialCarousels }: { initialCarousels: AdminProductCarousel[] }) {
  const [carousels, setCarousels] = useState(initialCarousels);
  const [selectedId, setSelectedId] = useState<number | null>(initialCarousels[0]?.id ?? null);
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [queries, setQueries] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, AdminMedicine[]>>({});
  const [draggedMedicineId, setDraggedMedicineId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => carousels.find((carousel) => carousel.id === selectedId) ?? carousels[0] ?? null,
    [carousels, selectedId],
  );

  const accept = (response: ActionResponse, ok: string) => {
    if (response.success) {
      setCarousels(response.carousels);
      setMessage(ok);
    } else {
      setMessage(`Ошибка: ${response.error}`);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const nextOrder = carousels.reduce((max, item) => Math.max(max, item.sort_order), 0) + 10;
    const response = await createCarousel(newSlug, newTitle, nextOrder);
    accept(response, 'Карусель создана');
    if (response.success) {
      setNewSlug('');
      setNewTitle('');
      const created = response.carousels.find((item) => item.slug === newSlug.trim());
      if (created) setSelectedId(created.id);
    }
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
    // Keep the query and result list visible so several medicines can be added in one search.
    accept(response, 'Товар добавлен');
    setBusy(false);
  };

  const updateProduct = (carouselId: number, medicineId: number, imageUrl: string) => {
    setCarousels((current) => current.map((carousel) => carousel.id !== carouselId ? carousel : {
      ...carousel,
      products: carousel.products.map((product) => product.medicine_id === medicineId ? { ...product, image_url: imageUrl } : product),
    }));
  };

  const saveProduct = async (carouselId: number, product: AdminCarouselProduct) => {
    setBusy(true);
    accept(await saveCarouselProduct(carouselId, product.medicine_id, product.sort_order, product.image_url || ''), 'Товар сохранён');
    setBusy(false);
  };

  const uploadProductImage = async (carouselId: number, product: AdminCarouselProduct, file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage('Подготовка изображения...');
    try {
      const optimized = await optimizeProductImage(file);
      const form = new FormData();
      form.set('file', optimized);
      form.set('scope', 'products');
      const upload = await fetch('/api/admin/media/images', { method: 'POST', body: form });
      const payload = await upload.json() as { url?: string; error?: string };
      if (!upload.ok || !payload.url) throw new Error(payload.error || 'Не удалось загрузить изображение');
      accept(
        await saveCarouselProduct(carouselId, product.medicine_id, product.sort_order, payload.url),
        'Изображение загружено и товар сохранён',
      );
    } catch (error) {
      setMessage(`Ошибка: ${error instanceof Error ? error.message : 'не удалось загрузить изображение'}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteProduct = async (carouselId: number, product: AdminCarouselProduct) => {
    if (!confirm(`Убрать «${product.medicine_name}» из этой карусели?`)) return;
    setBusy(true);
    accept(await removeCarouselProduct(carouselId, product.medicine_id), 'Товар убран из карусели');
    setBusy(false);
  };

  const dropProduct = async (carousel: AdminProductCarousel, targetMedicineId: number) => {
    const sourceMedicineId = draggedMedicineId;
    setDraggedMedicineId(null);
    if (sourceMedicineId === null || sourceMedicineId === targetMedicineId || busy) return;
    const previous = carousel.products;
    const from = previous.findIndex((item) => item.medicine_id === sourceMedicineId);
    const to = previous.findIndex((item) => item.medicine_id === targetMedicineId);
    if (from < 0 || to < 0) return;
    const reordered = [...previous];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const orderedProducts = reordered.map((item, index) => ({ ...item, sort_order: (index + 1) * 10 }));
    setCarousels((current) => current.map((item) => item.id === carousel.id ? { ...item, products: orderedProducts } : item));
    setBusy(true);
    const response = await reorderCarouselProducts(carousel.id, orderedProducts.map((item) => item.medicine_id));
    if (response.success) {
      setCarousels(response.carousels);
      setMessage('Новый порядок товаров сохранён');
    } else {
      setCarousels((current) => current.map((item) => item.id === carousel.id ? { ...item, products: previous } : item));
      setMessage(`Ошибка: ${response.error}`);
    }
    setBusy(false);
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Карусели товаров</h1>
      <p style={{ margin: '0 0 24px', color: '#666' }}>
        Выберите карусель слева. Справа показаны только её настройки и лекарства.
      </p>

      {message && <p role="status" style={{ color: message.startsWith('Ошибка') ? '#b42318' : '#166534' }}>{message}</p>}

      <div className="admin-carousel-workspace">
        <aside className="admin-carousel-list-panel">
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Список каруселей</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {carousels.map((carousel) => (
              <button
                key={carousel.id}
                type="button"
                onClick={() => setSelectedId(carousel.id)}
                className={`admin-carousel-list-button${selected?.id === carousel.id ? ' active' : ''}`}
              >
                <strong>{carousel.title}</strong>
                <small>{carousel.products.length} товаров · {carousel.is_active ? 'активна' : 'отключена'}</small>
              </button>
            ))}
            {carousels.length === 0 && <p style={{ color: '#777' }}>Каруселей пока нет.</p>}
          </div>

          <form onSubmit={create} style={{ borderTop: '1px solid #eee', marginTop: 20, paddingTop: 18, display: 'grid', gap: 10 }}>
            <strong>Новая карусель</strong>
            <input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="slug: seasonal-offers" style={inputStyle} />
            <input required minLength={2} maxLength={120} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Название карусели" style={inputStyle} />
            <button disabled={busy} type="submit">Создать</button>
          </form>
        </aside>

        <div className="admin-carousel-detail-panel">
          {!selected ? (
            <div style={{ background: 'white', padding: 30, borderRadius: 12, color: '#777' }}>Выберите или создайте карусель.</div>
          ) : (
            <section style={{ display: 'grid', gap: 18 }}>
              <div style={{ background: 'white', border: '1px solid #e4e4e4', borderRadius: 14, padding: 20 }}>
                <div style={{ marginBottom: 15 }}>
                  <small style={{ color: '#777' }}>Карусель · {selected.slug}</small>
                  <h2 style={{ margin: '4px 0 0' }}>{selected.title}</h2>
                </div>
                <div className="admin-carousel-heading" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) 110px auto auto', gap: 12, alignItems: 'end' }}>
                  <label><span style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>Название карусели</span><input value={selected.title} onChange={(event) => updateCarousel(selected.id, 'title', event.target.value)} style={inputStyle} /></label>
                  <label><span style={{ display: 'block', fontSize: 12, marginBottom: 5 }}>Порядок секции</span><input type="number" min={0} max={100000} value={selected.sort_order} onChange={(event) => updateCarousel(selected.id, 'sort_order', Number(event.target.value))} style={inputStyle} /></label>
                  <label style={{ paddingBottom: 10 }}><input type="checkbox" checked={selected.is_active} onChange={(event) => updateCarousel(selected.id, 'is_active', event.target.checked)} /> Активна</label>
                  <div style={{ display: 'flex', gap: 8 }}><button disabled={busy} type="button" onClick={() => saveSection(selected)}>Сохранить</button><button disabled={busy} type="button" onClick={() => deleteSection(selected)} style={{ color: '#b42318' }}>Удалить</button></div>
                </div>
              </div>

              <div style={{ background: 'white', border: '1px solid #e4e4e4', borderRadius: 14, padding: 20 }}>
                <h3 style={{ marginTop: 0 }}>Добавить лекарства</h3>
                <form onSubmit={(event) => search(event, selected.id)} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <input value={queries[selected.id] || ''} onChange={(event) => setQueries((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Название или артикул лекарства" style={inputStyle} />
                  <button disabled={busy} type="submit">Найти</button>
                </form>
                {(results[selected.id] || []).map((medicine) => {
                  const duplicate = selected.products.some((item) => item.medicine_id === medicine.medicine_id);
                  return (
                    <div key={medicine.medicine_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 10, background: '#f7f7f7', marginBottom: 6, borderRadius: 8 }}>
                      <span><strong>{medicine.medicine_name}</strong><small style={{ display: 'block', color: '#777' }}>Артикул {medicine.medicine_id} · {medicine.selling_unit_price} с.</small></span>
                      <button type="button" disabled={busy || duplicate} onClick={() => addProduct(selected, medicine.medicine_id)}>{duplicate ? 'Добавлен' : 'Добавить'}</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: 'white', border: '1px solid #e4e4e4', borderRadius: 14, padding: 20 }}>
                <h3 style={{ margin: '0 0 5px' }}>Товары в карусели «{selected.title}»</h3>
                <p style={{ color: '#777', marginTop: 0 }}>Перетащите строку за значок ↕, чтобы изменить порядок.</p>
                <div style={{ display: 'grid', gap: 12 }}>
                  {selected.products.map((product, index) => (
                    <article
                      className="admin-carousel-product-row"
                      key={product.medicine_id}
                      draggable={!busy}
                      onDragStart={() => setDraggedMedicineId(product.medicine_id)}
                      onDragEnd={() => setDraggedMedicineId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => void dropProduct(selected, product.medicine_id)}
                      style={{ display: 'grid', gridTemplateColumns: '40px 90px minmax(180px, 1.3fr) minmax(220px, 2fr) auto', gap: 14, alignItems: 'center', padding: 12, border: draggedMedicineId === product.medicine_id ? '2px solid var(--primary)' : '1px solid #eee', borderRadius: 10 }}
                    >
                      <div title="Перетащить" style={{ cursor: 'grab', fontSize: 24, color: '#888', textAlign: 'center' }}>↕<small style={{ display: 'block', fontSize: 10 }}>{index + 1}</small></div>
                      <ProductPreview product={product} />
                      <div><strong>{product.medicine_name}</strong><small style={{ display: 'block', color: '#777', marginTop: 4 }}>Артикул {product.medicine_id} · {product.in_stock ? 'в наличии' : 'нет в наличии'}</small></div>
                      <div>
                        <label><span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>HTTPS-ссылка на изображение</span><input type="url" value={product.image_url || ''} onChange={(event) => updateProduct(selected.id, product.medicine_id, event.target.value)} placeholder="https://..." style={inputStyle} /></label>
                        <label style={{ display: 'block', marginTop: 7 }}><span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Или загрузить с компьютера</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void uploadProductImage(selected.id, product, event.target.files?.[0])} style={{ ...inputStyle, padding: 6, fontSize: 12 }} /></label>
                      </div>
                      <div style={{ display: 'flex', gap: 7 }}><button disabled={busy} type="button" onClick={() => saveProduct(selected.id, product)}>Сохранить</button><button disabled={busy} type="button" onClick={() => deleteProduct(selected.id, product)} style={{ color: '#b42318' }}>Убрать</button></div>
                    </article>
                  ))}
                  {selected.products.length === 0 && <div style={{ padding: 18, color: '#777', background: '#fafafa', borderRadius: 9 }}>В этой карусели пока нет товаров.</div>}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

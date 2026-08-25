'use client';

import { useMemo, useState } from 'react';
import {
  addSelectedCarouselProducts,
  createCarousel,
  getCarouselProducts,
  removeCarousel,
  removeSelectedCarouselProducts,
  reorderCarouselPage,
  reorderCarousels,
  saveCarousel,
  saveCarouselProduct,
  searchCarouselCandidates,
} from './actions';
import type {
  AdminCarouselProduct,
  AdminMedicineCandidate,
  AdminNumberedPage,
  AdminProductCarousel,
} from '@/lib/api-v1/admin-types';
import { selectPage, toggleSelection } from '@/lib/admin-selection';

const EMPTY_PAGE: AdminNumberedPage = { number: 1, size: 20, total_items: 0, total_pages: 1 };

function PageNav({ page, busy, onPage }: { page: AdminNumberedPage; busy: boolean; onPage: (page: number) => void }) {
  if (page.total_pages <= 1) return null;
  return (
    <div className="admin-pagination">
      <button type="button" disabled={busy || page.number <= 1} onClick={() => onPage(page.number - 1)}>Назад</button>
      <span className="current">{page.number} / {page.total_pages}</span>
      <button type="button" disabled={busy || page.number >= page.total_pages} onClick={() => onPage(page.number + 1)}>Далее</button>
    </div>
  );
}

async function optimizeProductImage(file: File): Promise<File> {
  if (file.size <= 2.5 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84));
  if (!blob) throw new Error('Не удалось подготовить изображение');
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
}

function ProductPreview({ product }: { product: AdminCarouselProduct }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="admin-product-thumb">
      {product.image_url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt="" onError={() => setFailed(true)} loading="lazy" />
      ) : <span>Нет фото</span>}
    </div>
  );
}

export default function CarouselsClient({
  initialCarousels,
  initialProducts,
  initialProductsPage,
}: {
  initialCarousels: AdminProductCarousel[];
  initialProducts: AdminCarouselProduct[];
  initialProductsPage: AdminNumberedPage;
}) {
  const [carousels, setCarousels] = useState(initialCarousels);
  const [selectedId, setSelectedId] = useState<number | null>(initialCarousels[0]?.id ?? null);
  const [products, setProducts] = useState<AdminCarouselProduct[]>(initialProducts);
  const [productsPage, setProductsPage] = useState(initialProductsPage);
  const [productsQuery, setProductsQuery] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [draggedProductId, setDraggedProductId] = useState<number | null>(null);

  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidates, setCandidates] = useState<AdminMedicineCandidate[]>([]);
  const [candidatePage, setCandidatePage] = useState(EMPTY_PAGE);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());

  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [draggedCarouselId, setDraggedCarouselId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => carousels.find((carousel) => carousel.id === selectedId) ?? carousels[0] ?? null,
    [carousels, selectedId],
  );

  const loadProducts = async (carouselId: number, page = 1, q = productsQuery) => {
    setBusy(true);
    const response = await getCarouselProducts(carouselId, page, q);
    if (response.success) {
      setProducts(response.items);
      setProductsPage(response.page);
      setSelectedProducts(new Set());
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const selectCarousel = (carouselId: number) => {
    setSelectedId(carouselId);
    setProductsQuery('');
    setCandidates([]);
    setCandidatePage(EMPTY_PAGE);
    setSelectedCandidates(new Set());
    void loadProducts(carouselId, 1, '');
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const response = await createCarousel(newSlug, newTitle, (carousels.length + 1) * 10);
    if (response.success) {
      setCarousels(response.carousels);
      const created = response.carousels.find((item) => item.slug === newSlug.trim());
      if (created) {
        setSelectedId(created.id);
        setProducts([]);
        setProductsPage(EMPTY_PAGE);
        setProductsQuery('');
        setCandidateQuery('');
        setCandidates([]);
        setCandidatePage(EMPTY_PAGE);
        setSelectedProducts(new Set());
        setSelectedCandidates(new Set());
      }
      setNewSlug(''); setNewTitle(''); setMessage('Карусель создана');
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const updateSelected = (field: 'title' | 'is_active', value: string | boolean) => {
    if (!selected) return;
    setCarousels((current) => current.map((item) => item.id === selected.id ? { ...item, [field]: value } : item));
  };

  const saveSection = async () => {
    if (!selected) return;
    setBusy(true);
    const response = await saveCarousel(selected.id, selected.title, selected.is_active, selected.sort_order);
    if (response.success) { setCarousels(response.carousels); setMessage('Карусель сохранена'); }
    else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const deleteSection = async () => {
    if (!selected || !confirm(`Удалить карусель «${selected.title}» и её связи? Лекарства и изображения не удаляются.`)) return;
    setBusy(true);
    const response = await removeCarousel(selected.id);
    if (response.success) {
      setCarousels(response.carousels);
      const nextId = response.carousels[0]?.id ?? null;
      setSelectedId(nextId);
      setProductsQuery('');
      setCandidateQuery('');
      setCandidates([]);
      setCandidatePage(EMPTY_PAGE);
      setSelectedProducts(new Set());
      setSelectedCandidates(new Set());
      if (nextId === null) {
        setProducts([]);
        setProductsPage(EMPTY_PAGE);
      } else {
        await loadProducts(nextId, 1, '');
      }
      setMessage('Карусель удалена');
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const moveCarousel = async (carouselId: number, direction: -1 | 1, targetId?: number) => {
    const from = carousels.findIndex((item) => item.id === carouselId);
    const to = targetId === undefined ? from + direction : carousels.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || to >= carousels.length || from === to || busy) return;
    const previous = carousels;
    const reordered = [...carousels];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setCarousels(reordered.map((item, index) => ({ ...item, sort_order: (index + 1) * 10 })));
    setBusy(true);
    const response = await reorderCarousels(reordered.map((item) => item.id));
    if (response.success) { setCarousels(response.carousels); setMessage('Порядок каруселей сохранён'); }
    else { setCarousels(previous); setMessage(`Ошибка: ${response.error}`); }
    setBusy(false);
  };

  const searchCandidates = async (page = 1) => {
    if (!selected || candidateQuery.trim().length < 2) { setMessage('Ошибка: введите минимум 2 символа'); return; }
    setBusy(true);
    const response = await searchCarouselCandidates(selected.id, candidateQuery, page);
    if (response.success) {
      setCandidates(response.items);
      setCandidatePage(response.page ?? EMPTY_PAGE);
      setSelectedCandidates(new Set());
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const addSelected = async () => {
    if (!selected || selectedCandidates.size === 0) return;
    const ids = [...selectedCandidates];
    setBusy(true);
    const response = await addSelectedCarouselProducts(selected.id, ids);
    if (response.success) {
      setCarousels(response.carousels);
      setSelectedCandidates(new Set());
      setMessage(`Выбрано: ${response.result.selected}; добавлено: ${response.result.added}; уже было: ${response.result.already_present}.`);
      await loadProducts(selected.id, 1);
      await searchCandidates(candidatePage.number);
    } else { setMessage(`Ошибка: ${response.error}`); setBusy(false); }
  };

  const removeSelected = async () => {
    if (!selected || selectedProducts.size === 0) return;
    const ids = [...selectedProducts];
    if (!confirm(`Убрать из карусели «${selected.title}» выбранные связи: ${ids.length}?\n\nЛекарства, image_url и S3-файлы не удаляются.`)) return;
    setBusy(true);
    const response = await removeSelectedCarouselProducts(selected.id, ids);
    if (response.success) {
      setCarousels(response.carousels);
      setMessage(`Убрано: ${response.result.removed}; уже отсутствовало: ${response.result.already_absent}.`);
      const remaining = Math.max(0, productsPage.total_items - response.result.removed);
      const lastPage = Math.max(1, Math.ceil(remaining / productsPage.size));
      await loadProducts(selected.id, Math.min(productsPage.number, lastPage));
    } else { setMessage(`Ошибка: ${response.error}`); setBusy(false); }
  };

  const updateProductImage = (medicineId: number, imageUrl: string) => {
    setProducts((current) => current.map((item) => item.medicine_id === medicineId ? { ...item, image_url: imageUrl } : item));
  };

  const saveProduct = async (product: AdminCarouselProduct) => {
    if (!selected) return;
    setBusy(true);
    const response = await saveCarouselProduct(selected.id, product.medicine_id, product.sort_order, product.image_url || '');
    if (response.success) { setCarousels(response.carousels); setMessage('Товар сохранён'); }
    else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const uploadImage = async (product: AdminCarouselProduct, file: File | undefined) => {
    if (!selected || !file) return;
    setBusy(true);
    try {
      const optimized = await optimizeProductImage(file);
      const form = new FormData(); form.set('file', optimized); form.set('scope', 'products');
      const upload = await fetch('/api/admin/media/images', { method: 'POST', body: form });
      const payload = await upload.json() as { url?: string; error?: string };
      if (!upload.ok || !payload.url) throw new Error(payload.error || 'Не удалось загрузить изображение');
      const response = await saveCarouselProduct(selected.id, product.medicine_id, product.sort_order, payload.url);
      if (!response.success) throw new Error(response.error);
      updateProductImage(product.medicine_id, payload.url);
      setCarousels(response.carousels);
      setMessage('Изображение загружено');
    } catch (error) {
      setMessage(`Ошибка: ${error instanceof Error ? error.message : 'не удалось загрузить изображение'}`);
    }
    setBusy(false);
  };

  const moveProduct = async (medicineId: number, direction: -1 | 1, targetId?: number) => {
    if (!selected || productsQuery.trim() || busy) return;
    const from = products.findIndex((item) => item.medicine_id === medicineId);
    const to = targetId === undefined ? from + direction : products.findIndex((item) => item.medicine_id === targetId);
    if (from < 0 || to < 0 || to >= products.length || from === to) return;
    const previous = products;
    const reordered = [...products];
    const [moved] = reordered.splice(from, 1); reordered.splice(to, 0, moved);
    setProducts(reordered);
    setBusy(true);
    const response = await reorderCarouselPage(selected.id, reordered.map((item) => item.medicine_id));
    if (response.success) { setMessage('Порядок товаров на странице сохранён'); await loadProducts(selected.id, productsPage.number, ''); }
    else { setProducts(previous); setMessage(`Ошибка: ${response.error}`); setBusy(false); }
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Карусели товаров</h1>
      <p style={{ margin: '0 0 20px', color: '#666' }}>Секции и товары загружаются компактно; public carousel limits не изменены.</p>
      {message && <div className={message.startsWith('Ошибка') ? 'admin-inline-error' : 'admin-success-message'} role="status">{message}</div>}

      <div className="admin-master-detail">
        <aside className="admin-entity-list-panel">
          <div className="admin-sticky-toolbar"><strong>Карусели ({carousels.length})</strong></div>
          <div className="admin-compact-list">
            {carousels.map((carousel, index) => (
              <div
                key={carousel.id}
                draggable={!busy}
                onDragStart={() => setDraggedCarouselId(carousel.id)}
                onDragEnd={() => setDraggedCarouselId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedCarouselId !== null) void moveCarousel(draggedCarouselId, 1, carousel.id);
                  setDraggedCarouselId(null);
                }}
                className={`admin-entity-list-row${selected?.id === carousel.id ? ' active' : ''}`}
              >
                <button type="button" disabled={busy} className="admin-entity-select" onClick={() => selectCarousel(carousel.id)}>
                  <span aria-hidden>↕</span><span><strong>{carousel.title}</strong><small>{carousel.product_count} товаров · {carousel.is_active ? 'активна' : 'отключена'}</small></span>
                </button>
                <div className="admin-order-buttons">
                  <button aria-label="Выше" type="button" disabled={busy || index === 0} onClick={() => moveCarousel(carousel.id, -1)}>↑</button>
                  <button aria-label="Ниже" type="button" disabled={busy || index === carousels.length - 1} onClick={() => moveCarousel(carousel.id, 1)}>↓</button>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={create} className="admin-sidebar-create-form">
            <strong>Новая карусель</strong>
            <input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="slug" />
            <input required minLength={2} maxLength={120} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Название" />
            <button disabled={busy} type="submit">Создать</button>
          </form>
        </aside>

        <main className="admin-entity-detail-panel">
          {!selected ? <div className="admin-empty-panel">Создайте или выберите карусель.</div> : (
            <>
              <section className="admin-entity-header">
                <div><small>{selected.slug}</small><h2>{selected.title}</h2></div>
                <div className="admin-toolbar-actions"><button disabled={busy} type="button" onClick={saveSection}>Сохранить</button><button disabled={busy} type="button" onClick={deleteSection} className="admin-danger-button">Удалить</button></div>
                <div className="admin-filter-row admin-section-settings">
                  <input value={selected.title} onChange={(event) => updateSelected('title', event.target.value)} aria-label="Название карусели" />
                  <label><input type="checkbox" checked={selected.is_active} onChange={(event) => updateSelected('is_active', event.target.checked)} /> Активна</label>
                </div>
              </section>

              <section className="admin-card-panel">
                <div className="admin-sticky-toolbar admin-selection-toolbar">
                  <div><strong>Добавить лекарства</strong><small>Найдено: {candidatePage.total_items} · выбрано: {selectedCandidates.size}</small></div>
                  <button type="button" disabled={busy || selectedCandidates.size === 0} onClick={addSelected}>Добавить выбранные ({selectedCandidates.size})</button>
                </div>
                <form className="admin-filter-row" onSubmit={(event) => { event.preventDefault(); void searchCandidates(1); }}>
                  <input minLength={2} value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Название, medicine_id или SKU" />
                  <button disabled={busy} type="submit">Найти</button>
                </form>
                <div className="admin-compact-table-list">
                  {candidates.map((item) => (
                    <label key={item.medicine_id} className={`admin-check-row${item.already_present ? ' muted' : ''}`}>
                      <input type="checkbox" disabled={item.already_present} checked={selectedCandidates.has(item.medicine_id)} onChange={() => setSelectedCandidates((current) => toggleSelection(current, item.medicine_id))} />
                      <span><strong>{item.medicine_name}</strong><small>ID {item.medicine_id} · {item.already_present ? 'уже в карусели' : `${item.selling_unit_price} с.`}</small></span>
                    </label>
                  ))}
                </div>
                <PageNav page={candidatePage} busy={busy} onPage={searchCandidates} />
              </section>

              <section className="admin-card-panel">
                <div className="admin-sticky-toolbar admin-selection-toolbar">
                  <div><strong>Товары: {productsPage.total_items}</strong><small>Выбрано: {selectedProducts.size}</small></div>
                  <div className="admin-toolbar-actions">
                    <button type="button" disabled={busy || products.length === 0} onClick={() => setSelectedProducts(selectPage(products.map((item) => item.medicine_id)))}>Выбрать страницу</button>
                    <button type="button" disabled={busy || selectedProducts.size === 0} onClick={removeSelected} className="admin-danger-button">Убрать выбранные ({selectedProducts.size})</button>
                  </div>
                </div>
                <form className="admin-filter-row" onSubmit={(event) => { event.preventDefault(); void loadProducts(selected.id, 1); }}>
                  <input value={productsQuery} onChange={(event) => setProductsQuery(event.target.value)} placeholder="Поиск внутри карусели" />
                  <button disabled={busy} type="submit">Найти</button>
                </form>
                {productsQuery.trim() && <p className="admin-help-text">Очистите поиск, чтобы менять порядок товаров.</p>}
                <div className="admin-compact-table-list">
                  {products.map((product, index) => (
                    <article
                      key={product.medicine_id}
                      className="admin-carousel-compact-row"
                      draggable={!busy && !productsQuery.trim()}
                      onDragStart={() => setDraggedProductId(product.medicine_id)}
                      onDragEnd={() => setDraggedProductId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggedProductId !== null) void moveProduct(draggedProductId, 1, product.medicine_id);
                        setDraggedProductId(null);
                      }}
                    >
                      <input type="checkbox" checked={selectedProducts.has(product.medicine_id)} onChange={() => setSelectedProducts((current) => toggleSelection(current, product.medicine_id))} aria-label={`Выбрать ${product.medicine_name}`} />
                      <div className="admin-order-buttons vertical">
                        <span title="Перетащить">↕ {((productsPage.number - 1) * productsPage.size) + index + 1}</span>
                        <button aria-label="Выше" type="button" disabled={busy || !!productsQuery.trim() || index === 0} onClick={() => moveProduct(product.medicine_id, -1)}>↑</button>
                        <button aria-label="Ниже" type="button" disabled={busy || !!productsQuery.trim() || index === products.length - 1} onClick={() => moveProduct(product.medicine_id, 1)}>↓</button>
                      </div>
                      <ProductPreview product={product} />
                      <div className="admin-product-name"><strong>{product.medicine_name}</strong><small>ID {product.medicine_id} · {product.in_stock ? 'в наличии' : 'нет в наличии'}</small></div>
                      <div className="admin-image-controls">
                        <input type="url" value={product.image_url || ''} onChange={(event) => updateProductImage(product.medicine_id, event.target.value)} placeholder="HTTPS image URL" />
                        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void uploadImage(product, event.target.files?.[0])} />
                      </div>
                      <button disabled={busy} type="button" onClick={() => saveProduct(product)}>Сохранить</button>
                    </article>
                  ))}
                  {!busy && products.length === 0 && <div className="admin-empty-row">В этой карусели ничего не найдено.</div>}
                </div>
                <PageNav page={productsPage} busy={busy} onPage={(page) => loadProducts(selected.id, page)} />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

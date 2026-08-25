'use client';

import { useMemo, useState } from 'react';
import {
  addSelectedCategoryMedicines,
  bulkAddCategoryMedicines,
  createCategory,
  deleteCategory,
  getCategoryMedicines,
  previewCategoryMedicineBulkAdd,
  removeSelectedCategoryMedicines,
  reorderCategories,
  searchCategoryMedicineCandidates,
  updateCategory,
} from './actions';
import type {
  AdminBatchAddResult,
  AdminCategory,
  AdminCategoryMedicine,
  AdminCategoryMedicineBulkPreviewResponse,
  AdminMedicineCandidate,
  AdminNumberedPage,
} from '@/lib/api-v1/admin-types';
import { selectPage, toggleSelection } from '@/lib/admin-selection';

const EMPTY_PAGE: AdminNumberedPage = { number: 1, size: 25, total_items: 0, total_pages: 1 };

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

export default function CategoriesClient({
  initialCategories,
  initialItems,
  initialItemsPage,
}: {
  initialCategories: AdminCategory[];
  initialItems: AdminCategoryMedicine[];
  initialItemsPage: AdminNumberedPage;
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [selectedId, setSelectedId] = useState<number | null>(initialCategories[0]?.id ?? null);
  const [items, setItems] = useState<AdminCategoryMedicine[]>(initialItems);
  const [itemsPage, setItemsPage] = useState(initialItemsPage);
  const [itemsQuery, setItemsQuery] = useState('');
  const [availability, setAvailability] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidates, setCandidates] = useState<AdminMedicineCandidate[]>([]);
  const [candidatePage, setCandidatePage] = useState(EMPTY_PAGE);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());

  const [bulkFragment, setBulkFragment] = useState('');
  const [bulkPreview, setBulkPreview] = useState<AdminCategoryMedicineBulkPreviewResponse | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<Set<number>>(new Set());

  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [draggedCategoryId, setDraggedCategoryId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selected = useMemo(
    () => categories.find((category) => category.id === selectedId) ?? categories[0] ?? null,
    [categories, selectedId],
  );

  const loadItems = async (categoryId: number, page = 1, q = itemsQuery, stock = availability) => {
    setBusy(true);
    const response = await getCategoryMedicines(categoryId, page, q, stock);
    if (response.success) {
      setItems(response.items);
      setItemsPage(response.page);
      setSelectedItems(new Set());
    } else {
      setMessage(`Ошибка: ${response.error}`);
    }
    setBusy(false);
  };

  const selectCategory = (categoryId: number) => {
    setSelectedId(categoryId);
    setItemsQuery('');
    setAvailability('all');
    setCandidates([]);
    setCandidatePage(EMPTY_PAGE);
    setSelectedCandidates(new Set());
    setBulkPreview(null);
    setSelectedPreview(new Set());
    void loadItems(categoryId, 1, '', 'all');
  };

  const refreshAfterMembershipChange = async (resultMessage: string, removed = 0) => {
    if (!selected) return;
    setMessage(resultMessage);
    const remaining = Math.max(0, itemsPage.total_items - removed);
    const lastPage = Math.max(1, Math.ceil(remaining / itemsPage.size));
    await loadItems(selected.id, Math.min(itemsPage.number, lastPage));
  };

  const removeSelected = async () => {
    if (!selected || selectedItems.size === 0) return;
    const ids = [...selectedItems];
    if (!confirm(`Удалить из категории «${selected.name}» выбранные связи: ${ids.length}?\n\nЛекарства и другие категории не изменятся.`)) return;
    setBusy(true);
    const response = await removeSelectedCategoryMedicines(selected.id, ids);
    if (response.success) {
      await refreshAfterMembershipChange(
        `Удалено: ${response.result.removed}. Уже отсутствовало: ${response.result.already_absent}.`,
        response.result.removed,
      );
    } else {
      setMessage(`Ошибка: ${response.error}`);
      setBusy(false);
    }
  };

  const searchCandidates = async (page = 1) => {
    if (!selected || candidateQuery.trim().length < 2) {
      setMessage('Ошибка: введите минимум 2 символа для поиска');
      return;
    }
    setBusy(true);
    const response = await searchCategoryMedicineCandidates(selected.id, candidateQuery, page);
    if (response.success) {
      setCandidates(response.items);
      setCandidatePage(response.page);
      setSelectedCandidates(new Set());
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const addIds = async (ids: number[], matched: number, label: string) => {
    if (!selected || ids.length === 0) return;
    setBusy(true);
    const response = await addSelectedCategoryMedicines(selected.id, ids);
    if (response.success) {
      const result: AdminBatchAddResult = response.result;
      setMessage(
        `${label}. Matched: ${matched}; selected: ${result.selected}; added: ${result.added}; already_present: ${result.already_present}.`,
      );
      setSelectedCandidates(new Set());
      setSelectedPreview(new Set());
      await loadItems(selected.id, 1);
      if (candidateQuery.trim().length >= 2) await searchCandidates(candidatePage.number);
    } else {
      setMessage(`Ошибка: ${response.error}`);
      setBusy(false);
    }
  };

  const loadBulkPreview = async (page = 1) => {
    if (!selected || bulkFragment.trim().length < 2) {
      setMessage('Ошибка: введите минимум 2 символа фрагмента');
      return;
    }
    setBusy(true);
    const response = await previewCategoryMedicineBulkAdd(selected.id, bulkFragment, page);
    if (response.success) {
      setBulkPreview(response.preview);
      setBulkFragment(response.preview.fragment);
      setSelectedPreview(new Set());
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const addAllPreviewed = async () => {
    if (!selected || !bulkPreview || bulkPreview.total === 0) return;
    if (!confirm(`Добавить все найденные лекарства в «${selected.name}»: ${bulkPreview.total}?`)) return;
    setBusy(true);
    const response = await bulkAddCategoryMedicines(selected.id, bulkPreview.fragment, bulkPreview.total);
    if (response.success) {
      setMessage(`Совпало: ${response.result.matched}; добавлено: ${response.result.added}; уже было: ${response.result.already_present}.`);
      await loadItems(selected.id, 1);
      await loadBulkPreview(bulkPreview.page.number);
    } else {
      setMessage(`Ошибка: ${response.error}`);
      setBusy(false);
    }
  };

  const moveCategory = async (categoryId: number, direction: -1 | 1, targetId?: number) => {
    const from = categories.findIndex((item) => item.id === categoryId);
    const to = targetId === undefined ? from + direction : categories.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || to >= categories.length || from === to || busy) return;
    const previous = categories;
    const reordered = [...categories];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setCategories(reordered.map((item, index) => ({ ...item, sort_order: (index + 1) * 10 })));
    setBusy(true);
    const response = await reorderCategories(reordered.map((item) => item.id));
    if (response.success) {
      setCategories(response.categories);
      setMessage('Порядок категорий сохранён');
    } else {
      setCategories(previous);
      setMessage(`Ошибка: ${response.error}`);
    }
    setBusy(false);
  };

  const createNewCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const response = await createCategory({ slug: newSlug.trim(), name: newName.trim(), sort_order: (categories.length + 1) * 10 });
    if (response.success) {
      const next = [...categories, response.category].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      setCategories(next);
      setSelectedId(response.category.id);
      setItems([]);
      setItemsPage(EMPTY_PAGE);
      setItemsQuery('');
      setAvailability('all');
      setSelectedItems(new Set());
      setCandidates([]);
      setCandidatePage(EMPTY_PAGE);
      setCandidateQuery('');
      setSelectedCandidates(new Set());
      setBulkPreview(null);
      setSelectedPreview(new Set());
      setNewSlug('');
      setNewName('');
      setMessage('Категория создана');
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const toggleCategory = async () => {
    if (!selected) return;
    setBusy(true);
    const response = await updateCategory({ id: selected.id, is_active: !selected.is_active });
    if (response.success) {
      setCategories((current) => current.map((item) => item.id === response.category.id ? response.category : item));
      setMessage(response.category.is_active ? 'Категория включена' : 'Категория отключена');
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  const removeCategory = async () => {
    if (!selected || !confirm(`Удалить категорию «${selected.name}»? Это возможно только без связанных товаров и баннеров.`)) return;
    setBusy(true);
    const response = await deleteCategory(selected.id);
    if (response.success) {
      const next = categories.filter((item) => item.id !== selected.id);
      setCategories(next);
      const nextId = next[0]?.id ?? null;
      setSelectedId(nextId);
      setItemsQuery('');
      setAvailability('all');
      setCandidates([]);
      setCandidateQuery('');
      setBulkPreview(null);
      setSelectedItems(new Set());
      setSelectedCandidates(new Set());
      setSelectedPreview(new Set());
      if (nextId === null) {
        setItems([]);
        setItemsPage(EMPTY_PAGE);
      } else {
        await loadItems(nextId, 1, '', 'all');
      }
      setMessage('Категория удалена');
    } else setMessage(`Ошибка: ${response.error}`);
    setBusy(false);
  };

  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Категории</h1>
      <p style={{ margin: '0 0 20px', color: '#666' }}>Слева выберите категорию, справа управляйте её товарами небольшими страницами.</p>
      {message && <div className={message.startsWith('Ошибка') ? 'admin-inline-error' : 'admin-success-message'} role="status">{message}</div>}

      <div className="admin-master-detail">
        <aside className="admin-entity-list-panel">
          <div className="admin-sticky-toolbar"><strong>Категории ({categories.length})</strong></div>
          <div className="admin-compact-list">
            {categories.map((category, index) => (
              <div
                key={category.id}
                draggable={!busy}
                onDragStart={() => setDraggedCategoryId(category.id)}
                onDragEnd={() => setDraggedCategoryId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedCategoryId !== null) void moveCategory(draggedCategoryId, 1, category.id);
                  setDraggedCategoryId(null);
                }}
                className={`admin-entity-list-row${selected?.id === category.id ? ' active' : ''}`}
              >
                <button type="button" disabled={busy} className="admin-entity-select" onClick={() => selectCategory(category.id)}>
                  <span aria-hidden>↕ {category.icon || '💊'}</span>
                  <span><strong>{category.name}</strong><small>{category.is_active ? 'активна' : 'отключена'}</small></span>
                </button>
                <div className="admin-order-buttons">
                  <button aria-label="Выше" type="button" disabled={busy || index === 0} onClick={() => moveCategory(category.id, -1)}>↑</button>
                  <button aria-label="Ниже" type="button" disabled={busy || index === categories.length - 1} onClick={() => moveCategory(category.id, 1)}>↓</button>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={createNewCategory} className="admin-sidebar-create-form">
            <strong>Новая категория</strong>
            <input required minLength={2} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="slug" />
            <input required maxLength={255} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Название" />
            <button disabled={busy} type="submit">Создать</button>
          </form>
        </aside>

        <main className="admin-entity-detail-panel">
          {!selected ? <div className="admin-empty-panel">Создайте или выберите категорию.</div> : (
            <>
              <section className="admin-entity-header">
                <div><small>{selected.slug}</small><h2>{selected.name}</h2></div>
                <div className="admin-toolbar-actions">
                  <button type="button" disabled={busy} onClick={toggleCategory}>{selected.is_active ? 'Отключить' : 'Включить'}</button>
                  <button type="button" disabled={busy} onClick={removeCategory} className="admin-danger-button">Удалить</button>
                </div>
              </section>

              <section className="admin-card-panel">
                <div className="admin-sticky-toolbar admin-selection-toolbar">
                  <div><strong>Товары в категории: {itemsPage.total_items}</strong><small>Выбрано: {selectedItems.size}</small></div>
                  <div className="admin-toolbar-actions">
                    <button type="button" disabled={busy || items.length === 0} onClick={() => setSelectedItems(selectPage(items.map((item) => item.medicine_id)))}>Выбрать страницу</button>
                    <button type="button" disabled={busy || selectedItems.size === 0} onClick={removeSelected} className="admin-danger-button">Удалить выбранные ({selectedItems.size})</button>
                  </div>
                </div>
                <form className="admin-filter-row" onSubmit={(event) => { event.preventDefault(); void loadItems(selected.id, 1); }}>
                  <input value={itemsQuery} onChange={(event) => setItemsQuery(event.target.value)} placeholder="Поиск внутри категории" />
                  <select value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)}>
                    <option value="all">Все</option><option value="in_stock">В наличии</option><option value="out_of_stock">Не в наличии</option>
                  </select>
                  <button disabled={busy} type="submit">Найти</button>
                </form>
                <div className="admin-compact-table-list">
                  {items.map((item) => (
                    <label key={item.medicine_id} className="admin-check-row">
                      <input type="checkbox" checked={selectedItems.has(item.medicine_id)} onChange={() => setSelectedItems((current) => toggleSelection(current, item.medicine_id))} />
                      <span><strong>{item.medicine_name}</strong><small>ID {item.medicine_id} · {item.in_stock ? 'в наличии' : 'архив'} · {item.country || '—'}</small></span>
                    </label>
                  ))}
                  {!busy && items.length === 0 && <div className="admin-empty-row">Ничего не найдено.</div>}
                </div>
                <PageNav page={itemsPage} busy={busy} onPage={(page) => loadItems(selected.id, page)} />
              </section>

              <section className="admin-card-panel">
                <div className="admin-sticky-toolbar admin-selection-toolbar">
                  <div><strong>Добавить выбранные товары</strong><small>Найдено: {candidatePage.total_items} · выбрано: {selectedCandidates.size}</small></div>
                  <button type="button" disabled={busy || selectedCandidates.size === 0} onClick={() => addIds([...selectedCandidates], candidatePage.total_items, 'Выбранные товары обработаны')}>Добавить выбранные ({selectedCandidates.size})</button>
                </div>
                <form className="admin-filter-row" onSubmit={(event) => { event.preventDefault(); void searchCandidates(1); }}>
                  <input minLength={2} value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Название, medicine_id или SKU" />
                  <button disabled={busy} type="submit">Найти</button>
                </form>
                <div className="admin-compact-table-list">
                  {candidates.map((item) => (
                    <label key={item.medicine_id} className={`admin-check-row${item.already_present ? ' muted' : ''}`}>
                      <input type="checkbox" disabled={item.already_present} checked={selectedCandidates.has(item.medicine_id)} onChange={() => setSelectedCandidates((current) => toggleSelection(current, item.medicine_id))} />
                      <span><strong>{item.medicine_name}</strong><small>ID {item.medicine_id} · {item.already_present ? 'уже в категории' : 'можно добавить'}</small></span>
                    </label>
                  ))}
                </div>
                <PageNav page={candidatePage} busy={busy} onPage={searchCandidates} />
              </section>

              <section className="admin-card-panel">
                <div className="admin-sticky-toolbar admin-selection-toolbar">
                  <div><strong>Добавление по буквальному фрагменту</strong><small>Matched: {bulkPreview?.total ?? 0} · selected: {selectedPreview.size}</small></div>
                  <div className="admin-toolbar-actions">
                    <button type="button" disabled={busy || selectedPreview.size === 0} onClick={() => addIds([...selectedPreview], bulkPreview?.total ?? 0, 'Выбранные из preview обработаны')}>Добавить выбранные ({selectedPreview.size})</button>
                    <button type="button" disabled={busy || !bulkPreview || bulkPreview.total === 0} onClick={addAllPreviewed}>Добавить все найденные ({bulkPreview?.total ?? 0})</button>
                  </div>
                </div>
                <p className="admin-help-text">Регистр не важен; символы % и _ считаются обычными символами.</p>
                <form className="admin-filter-row" onSubmit={(event) => { event.preventDefault(); void loadBulkPreview(1); }}>
                  <input minLength={2} maxLength={120} value={bulkFragment} onChange={(event) => { setBulkFragment(event.target.value); setBulkPreview(null); setSelectedPreview(new Set()); }} placeholder="Например: now" />
                  <button disabled={busy} type="submit">Предпросмотр</button>
                </form>
                <div className="admin-compact-table-list">
                  {(bulkPreview?.data ?? []).map((item) => (
                    <label key={item.medicine_id} className={`admin-check-row${item.already_present ? ' muted' : ''}`}>
                      <input type="checkbox" disabled={item.already_present} checked={selectedPreview.has(item.medicine_id)} onChange={() => setSelectedPreview((current) => toggleSelection(current, item.medicine_id))} />
                      <span><strong>{item.medicine_name}</strong><small>ID {item.medicine_id} · {item.already_present ? 'уже в категории' : 'будет добавлено'}</small></span>
                    </label>
                  ))}
                </div>
                {bulkPreview && <PageNav page={bulkPreview.page} busy={busy} onPage={loadBulkPreview} />}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { createCategory, updateCategory, disableCategory, deleteCategory, getCategoryMedicines, addCategoryMedicine, removeCategoryMedicine, searchMedicinesForCategory } from './actions';
import type { AdminCategory, AdminCategoryMedicine } from '@/lib/api-v1/admin-types';

type SearchResult = { medicine_id: number; medicine_name: string; country?: string | null; vendor?: string | null; in_stock?: boolean };

export default function CategoriesClient({ initialCategories }: { initialCategories: AdminCategory[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null);
  
  const [formData, setFormData] = useState({ slug: '', name: '', icon: '', color: '', sort_order: '0' });

  const [managingCategory, setManagingCategory] = useState<AdminCategory | null>(null);
  const [categoryItems, setCategoryItems] = useState<AdminCategoryMedicine[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const handleOpenModal = (cat?: AdminCategory) => {
    if (cat) {
      setEditingCategory(cat);
      setFormData({ slug: cat.slug, name: cat.name, icon: cat.icon || '', color: cat.color || '', sort_order: String(cat.sort_order) });
    } else {
      setEditingCategory(null);
      setFormData({ slug: '', name: '', icon: '', color: '', sort_order: '0' });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    let res;
    if (editingCategory) {
      res = await updateCategory({ id: editingCategory.id, name: formData.name, icon: formData.icon, color: formData.color, sort_order: Number(formData.sort_order) });
    } else {
      res = await createCategory({ ...formData, sort_order: Number(formData.sort_order) });
    }
    
    if (res.success) {
      setCategories((current) => {
        const updated = editingCategory
          ? current.map((category) => category.id === res.category.id ? res.category : category)
          : [...current, res.category];
        return updated.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      });
      setIsModalOpen(false);
      setLoading(false);
    } else {
      setError(res.error || 'Ошибка сохранения');
      setLoading(false);
    }
  };

  const handleToggleActive = async (category: AdminCategory) => {
    const nextActive = !category.is_active;
    if (!confirm(nextActive ? 'Включить эту категорию?' : 'Отключить эту категорию? Товары и связи сохранятся.')) return;
    setLoading(true);
    const res = nextActive
      ? await updateCategory({ id: category.id, is_active: true })
      : await disableCategory(category.id);
    if (res.success) {
      setCategories((current) => current.map((item) => item.id === res.category.id ? res.category : item));
      setLoading(false);
    } else {
      alert(res.error || 'Ошибка изменения категории');
      setLoading(false);
    }
  };

  const handleDelete = async (category: AdminCategory) => {
    if (!window.confirm(`Удалить категорию «${category.name}»?\n\nУдаление возможно только если в категории нет товаров и на неё не ссылаются баннеры.`)) return;
    setLoading(true);
    setError('');
    const result = await deleteCategory(category.id);
    if (result.success) {
      setCategories((current) => current.filter((item) => item.id !== category.id));
    } else {
      setError(result.error || 'Не удалось удалить категорию');
      window.alert(result.error || 'Не удалось удалить категорию');
    }
    setLoading(false);
  };

  const handleManageItems = async (cat: AdminCategory) => {
    setManagingCategory(cat);
    setLoading(true);
    const res = await getCategoryMedicines(cat.id);
    if (res.success) {
      setCategoryItems(res.items ?? []);
    }
    setLoading(false);
  };

  const searchMedicines = async (event: React.FormEvent) => {
    event.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setError('Введите минимум 2 символа или точный medicine_id');
      return;
    }
    setLoading(true);
    setError('');
    const result = await searchMedicinesForCategory(q);
    if (result.success) setSearchResults(result.items);
    else setError(result.error || 'Ошибка поиска лекарств');
    setLoading(false);
  };

  const handleAddItem = async (medicineId: number) => {
    if (!managingCategory) return;
    setLoading(true);
    const res = await addCategoryMedicine(managingCategory.id, medicineId);
    if (res.success) {
      const itemsRes = await getCategoryMedicines(managingCategory.id);
      if (itemsRes.success) setCategoryItems(itemsRes.items ?? []);
      setSearchQuery('');
      setSearchResults([]);
    } else {
      alert(res.error || 'Ошибка добавления товара');
    }
    setLoading(false);
  };

  const handleRemoveItem = async (medicineId: number) => {
    if (!managingCategory) return;
    setLoading(true);
    const res = await removeCategoryMedicine(managingCategory.id, medicineId);
    if (res.success) {
      const itemsRes = await getCategoryMedicines(managingCategory.id);
      if (itemsRes.success) setCategoryItems(itemsRes.items ?? []);
    } else {
      alert(res.error || 'Ошибка удаления товара');
    }
    setLoading(false);
  };

  if (managingCategory) {
    return (
      <div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '30px' }}>
          <button onClick={() => setManagingCategory(null)} style={{ background: '#eee', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>&larr; Назад</button>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Товары в категории: {managingCategory.name}</h1>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', alignItems: 'start' }}>
          
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', border: '1px solid #E8E8E8' }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Товары ({categoryItems.length})</h3>
            {loading ? <p>Загрузка...</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {categoryItems.map((item) => (
                  <div key={item.medicine_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', border: '1px solid #eee', borderRadius: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>{item.medicine_name}<small style={{ display: 'block', color: '#777' }}>ID {item.medicine_id} · {item.in_stock ? 'в наличии' : 'архив'}</small></span>
                    <button onClick={() => handleRemoveItem(item.medicine_id)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Удалить</button>
                  </div>
                ))}
                {categoryItems.length === 0 && <p style={{ color: '#888' }}>Нет товаров в категории</p>}
              </div>
            )}
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', border: '1px solid #E8E8E8' }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Добавить товар</h3>
            <form onSubmit={searchMedicines} style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <input 
                type="text" 
                placeholder="Название, medicine_id или SKU"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none' }}
              />
              <button type="submit" disabled={loading}>Найти</button>
            </form>
            {error && <p style={{ color: '#c62828' }}>{error}</p>}
            
            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {searchResults.map((res) => (
                  <div key={res.medicine_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: '#F9F9F9', borderRadius: '8px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '500' }}>{res.medicine_name} <div style={{ fontSize: '12px', color: '#888', fontWeight: 'normal' }}>ID {res.medicine_id} · {res.country || '—'} · {res.vendor || '—'} · {res.in_stock ? 'в наличии' : 'архив'}</div></div>
                    <button onClick={() => handleAddItem(res.medicine_id)} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '5px 15px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Добавить</button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Управление Категориями</h1>
        <button onClick={() => handleOpenModal()} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          + Создать Категорию
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {error && <div className="admin-inline-error" role="alert" style={{ gridColumn: '1 / -1' }}>{error}</div>}
        {categories.map((cat) => (
          <div key={cat.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #E8E8E8', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
              <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: cat.color || '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                {cat.icon || '💊'}
              </div>
              <div>
                <h3 style={{ margin: '0 0 5px 0', fontSize: '18px' }}>{cat.name}</h3>
                <div style={{ fontSize: '12px', color: '#888' }}>{cat.slug} · порядок {cat.sort_order}</div>
                <div style={{ marginTop: 5, fontSize: 12, color: cat.is_active ? '#166534' : '#991b1b' }}>
                  {cat.is_active ? 'Активна' : 'Отключена'}
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
              <button onClick={() => handleManageItems(cat)} style={{ flex: 1, background: '#f5f5f5', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>Товары</button>
              <button onClick={() => handleOpenModal(cat)} style={{ background: '#e3f2fd', color: '#1976d2', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>Изменить</button>
              <button onClick={() => handleToggleActive(cat)} disabled={loading} style={{ background: cat.is_active ? '#ffebee' : '#e8f5e9', color: cat.is_active ? '#c62828' : '#2e7d32', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>
                {cat.is_active ? 'Отключить' : 'Включить'}
              </button>
              <button className="admin-danger-button" onClick={() => handleDelete(cat)} disabled={loading} type="button">
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'white', width: '100%', maxWidth: '400px', borderRadius: '16px', padding: '30px' }}>
            <h2 style={{ margin: '0 0 20px 0', fontSize: '20px' }}>{editingCategory ? 'Редактировать категорию' : 'Новая категория'}</h2>
            
            {error && <div style={{ color: 'red', marginBottom: '15px', fontSize: '14px' }}>{error}</div>}
            
            <form onSubmit={handleSave}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Название</label>
                <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Slug (Англ. без пробелов)</label>
                <input required disabled={!!editingCategory} type="text" value={formData.slug} onChange={e => setFormData({...formData, slug: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', background: editingCategory ? '#eee' : 'white' }} />
              </div>
              <div style={{ marginBottom: '15px', display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Emoji Иконка</label>
                  <input type="text" value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Цвет (HEX)</label>
                  <input type="text" value={formData.color} onChange={e => setFormData({...formData, color: e.target.value})} placeholder="#FFEBEE" style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                </div>
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Порядок отображения</label>
                <input required min="0" max="100000" type="number" value={formData.sort_order} onChange={e => setFormData({...formData, sort_order: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
              </div>
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '30px' }}>
                <button type="button" onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: '12px', background: '#eee', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Отмена</button>
                <button type="submit" disabled={loading} style={{ flex: 1, padding: '12px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {loading ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

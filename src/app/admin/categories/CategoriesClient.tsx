'use client';

import { useState } from 'react';
import { createCategory, updateCategory, deleteCategory, getCategoryMedicines, addCategoryMedicine, removeCategoryMedicine } from './actions';

export default function CategoriesClient({ initialCategories }: { initialCategories: any[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  
  const [formData, setFormData] = useState({ slug: '', name: '', icon: '', color: '' });

  const [managingCategory, setManagingCategory] = useState<any>(null);
  const [categoryItems, setCategoryItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleOpenModal = (cat?: any) => {
    if (cat) {
      setEditingCategory(cat);
      setFormData({ slug: cat.slug, name: cat.name, icon: cat.icon || '', color: cat.color || '' });
    } else {
      setEditingCategory(null);
      setFormData({ slug: '', name: '', icon: '', color: '' });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    let res;
    if (editingCategory) {
      res = await updateCategory({ id: editingCategory.id, name: formData.name, icon: formData.icon, color: formData.color });
    } else {
      res = await createCategory(formData);
    }
    
    if (res.success) {
      setIsModalOpen(false);
      window.location.reload(); // Quick refresh to get new server-side list
    } else {
      setError(res.error || 'Ошибка сохранения');
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту категорию?')) return;
    setLoading(true);
    const res = await deleteCategory(id);
    if (res.success) {
      window.location.reload();
    } else {
      alert(res.error || 'Ошибка удаления');
      setLoading(false);
    }
  };

  const handleManageItems = async (cat: any) => {
    setManagingCategory(cat);
    setLoading(true);
    const res = await getCategoryMedicines(cat.slug);
    if (res.success) {
      setCategoryItems(res.items);
    }
    setLoading(false);
  };

  const searchMedicines = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 3) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.matches || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddItem = async (medicineName: string) => {
    if (!managingCategory) return;
    setLoading(true);
    const res = await addCategoryMedicine(managingCategory.slug, medicineName);
    if (res.success) {
      const itemsRes = await getCategoryMedicines(managingCategory.slug);
      if (itemsRes.success) setCategoryItems(itemsRes.items);
      setSearchQuery('');
      setSearchResults([]);
    } else {
      alert(res.error || 'Ошибка добавления товара');
    }
    setLoading(false);
  };

  const handleRemoveItem = async (medicineName: string) => {
    if (!managingCategory) return;
    setLoading(true);
    const res = await removeCategoryMedicine(managingCategory.slug, medicineName);
    if (res.success) {
      const itemsRes = await getCategoryMedicines(managingCategory.slug);
      if (itemsRes.success) setCategoryItems(itemsRes.items);
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
                {categoryItems.map((item: any, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', border: '1px solid #eee', borderRadius: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>{item.medicine_name}</span>
                    <button onClick={() => handleRemoveItem(item.medicine_name)} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Удалить</button>
                  </div>
                ))}
                {categoryItems.length === 0 && <p style={{ color: '#888' }}>Нет товаров в категории</p>}
              </div>
            )}
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', border: '1px solid #E8E8E8' }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Добавить товар</h3>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <input 
                type="text" 
                placeholder="Поиск или точное название..."
                value={searchQuery}
                onChange={(e) => searchMedicines(e.target.value)}
                style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #E8E8E8', outline: 'none' }}
              />
              {searchQuery.trim().length > 0 && (
                <button 
                  onClick={() => handleAddItem(searchQuery.trim())}
                  disabled={loading}
                  style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '0 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                >
                  Добавить
                </button>
              )}
            </div>
            
            {searchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {searchResults.map((res: any, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: '#F9F9F9', borderRadius: '8px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '500' }}>{res.name} <div style={{ fontSize: '12px', color: '#888', fontWeight: 'normal' }}>{res.country}</div></div>
                    <button onClick={() => handleAddItem(res.name)} style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '5px 15px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>Добавить</button>
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
        {categories.map((cat: any) => (
          <div key={cat.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #E8E8E8', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
              <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: cat.color || '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                {cat.icon || '💊'}
              </div>
              <div>
                <h3 style={{ margin: '0 0 5px 0', fontSize: '18px' }}>{cat.name}</h3>
                <div style={{ fontSize: '12px', color: '#888' }}>{cat.slug}</div>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => handleManageItems(cat)} style={{ flex: 1, background: '#f5f5f5', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>Товары</button>
              <button onClick={() => handleOpenModal(cat)} style={{ background: '#e3f2fd', color: '#1976d2', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>Изменить</button>
              <button onClick={() => handleDelete(cat.id)} disabled={loading} style={{ background: '#ffebee', color: '#c62828', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>Удалить</button>
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

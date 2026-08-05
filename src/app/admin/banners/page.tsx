'use client';

import { useState } from 'react';

// Mock data since DB connection is not allowed directly
const initialBanners = [
  { id: 1, title: 'Скидка на витамины', link: '/category/vitamins', status: 'active', order: 1, img: 'https://via.placeholder.com/800x400?text=Vitamins+Banner' },
  { id: 2, title: 'Бесплатная доставка', link: '/cart', status: 'hidden', order: 2, img: 'https://via.placeholder.com/800x400?text=Free+Delivery' },
];

export default function AdminBanners() {
  const [banners, setBanners] = useState(initialBanners);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ title: '', link: '', status: 'active', order: 1, img: '' });

  const handleEdit = (banner: any) => {
    setEditingId(banner.id);
    setFormData({ title: banner.title, link: banner.link, status: banner.status, order: banner.order, img: banner.img });
  };

  const handleDelete = (id: number) => {
    if (confirm('Удалить баннер?')) {
      setBanners(banners.filter(b => b.id !== id));
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      setBanners(banners.map(b => b.id === editingId ? { ...formData, id: editingId } : b));
    } else {
      setBanners([...banners, { ...formData, id: Date.now() }]);
    }
    setEditingId(null);
    setFormData({ title: '', link: '', status: 'active', order: 1, img: '' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData({ title: '', link: '', status: 'active', order: 1, img: '' });
  };

  return (
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '30px' }}>Управление баннерами</h1>

      <div style={{ background: '#FFF3E0', padding: '20px', borderRadius: '12px', marginBottom: '30px', border: '1px solid #FFE0B2' }}>
        <p style={{ margin: 0, color: '#E65100', fontSize: '14px', lineHeight: '1.5' }}>
          <strong>Внимание:</strong> В данный момент компонент работает в <strong>Mock-режиме</strong> без прямого подключения к базе данных. <br/>
          Сохраненные баннеры не сохранятся при перезагрузке страницы. После подключения к API Gateway данные будут синхронизироваться.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '30px', alignItems: 'start' }}>
        
        {/* Banner List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {banners.sort((a,b) => a.order - b.order).map(banner => (
            <div key={banner.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #E8E8E8', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: '200px', height: '100px', background: '#f5f5f5', backgroundImage: `url(${banner.img})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                {!banner.img && <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '12px' }}>Нет фото</div>}
              </div>
              <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '16px' }}>{banner.title}</h3>
                  <div style={{ fontSize: '13px', color: '#888', marginBottom: '5px' }}>Сортировка: {banner.order} | Ссылка: {banner.link || '-'}</div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: banner.status === 'active' ? '#4CAF50' : '#f57f17' }}>
                    {banner.status === 'active' ? 'Активен' : 'Скрыт'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <button onClick={() => handleEdit(banner)} style={{ background: 'none', border: 'none', color: '#1976D2', cursor: 'pointer', fontSize: '13px', fontWeight: 500, padding: 0 }}>Редактировать</button>
                  <button onClick={() => handleDelete(banner.id)} style={{ background: 'none', border: 'none', color: '#d32f2f', cursor: 'pointer', fontSize: '13px', fontWeight: 500, padding: 0 }}>Удалить</button>
                </div>
              </div>
            </div>
          ))}
          {banners.length === 0 && <div style={{ color: '#888' }}>Нет баннеров</div>}
        </div>

        {/* Form */}
        <div style={{ background: 'white', padding: '25px', borderRadius: '12px', border: '1px solid #E8E8E8', position: 'sticky', top: '20px' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '20px' }}>{editingId ? 'Редактировать баннер' : 'Добавить баннер'}</h3>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Название (для удобства)</label>
              <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>URL картинки</label>
              <input type="url" required value={formData.img} onChange={e => setFormData({...formData, img: e.target.value})} placeholder="https://..." style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Ссылка при клике (URL)</label>
              <input type="text" value={formData.link} onChange={e => setFormData({...formData, link: e.target.value})} placeholder="/category/..." style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: '15px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Статус</label>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }}>
                  <option value="active">Активен</option>
                  <option value="hidden">Скрыт</option>
                </select>
              </div>
              <div style={{ width: '80px' }}>
                <label style={{ display: 'block', fontSize: '13px', color: '#666', marginBottom: '5px' }}>Порядок</label>
                <input type="number" required min="1" value={formData.order} onChange={e => setFormData({...formData, order: parseInt(e.target.value)})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }} />
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button type="submit" style={{ flex: 1, padding: '12px', borderRadius: '8px', background: 'var(--primary)', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                {editingId ? 'Сохранить' : 'Добавить'}
              </button>
              {editingId && (
                <button type="button" onClick={cancelEdit} style={{ flex: 1, padding: '12px', borderRadius: '8px', background: '#eee', color: '#333', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                  Отмена
                </button>
              )}
            </div>
          </form>
        </div>

      </div>

    </div>
  );
}

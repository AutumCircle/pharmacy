'use client';

import { useState } from 'react';
import CategoryIcon from '@/components/CategoryIcon';
import { localIconPreview, saveLocalIcon } from '@/lib/category-icon-preview';
import { updateCategory } from './actions';

export default function CategoryIconEditor({ id, icon, onSaved }: { id: number; icon: string | null; onSaved: (value: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(value: string) {
    if (localIconPreview) saveLocalIcon(id, value);
    else {
      const result = await updateCategory({ id, icon: value });
      if (!result.success) throw new Error(result.error);
      onSaved(value);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('');
    try {
      if (!['image/png', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Выберите SVG, PNG или WebP до 3 МБ');
      // SVG is decoded as an isolated image, never inserted into the document.
      // Persist only raster output so scripts/foreign content cannot be served.
      const url = URL.createObjectURL(file);
      const bitmap = new Image();
      try { bitmap.src = url; await bitmap.decode(); }
      catch { throw new Error('Не удалось прочитать изображение'); }
      finally { URL.revokeObjectURL(url); }
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Не удалось подготовить иконку');
      const ratio = Math.min(128 / bitmap.width, 128 / bitmap.height);
      const width = bitmap.width * ratio; const height = bitmap.height * ratio;
      context.drawImage(bitmap, (128 - width) / 2, (128 - height) / 2, width, height);
      if (localIconPreview) await save(canvas.toDataURL('image/png'));
      else {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Не удалось подготовить иконку');
        const form = new FormData(); form.set('file', blob, 'icon.png'); form.set('scope', 'categories');
        const response = await fetch('/api/admin/media/images', { method: 'POST', body: form });
        const result = await response.json();
        if (!response.ok || !result.url) throw new Error(result.error || 'Не удалось загрузить иконку');
        await save(result.url);
      }
      setMessage(localIconPreview ? 'Сохранено локально. Проверьте меню категорий и каталог в этом браузере.' : 'Иконка сохранена');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка загрузки'); }
    finally { setBusy(false); }
  }
  return <section className="admin-card-panel" style={{ padding: 16 }}>
    <h3>Иконка категории</h3>
    <p>{localIconPreview ? 'Локальный режим: изменения только в этом браузере, рабочий сайт не меняется.' : 'Загрузите свою иконку вместо эмоджи.'}</p>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <CategoryIcon id={id} icon={icon} size={48} />
      <label>Загрузить / заменить<input type="file" accept="image/svg+xml,image/png,image/webp" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
      <button type="button" disabled={busy} onClick={async () => { try { await save(''); setMessage('Иконка убрана'); } catch { setMessage('Не удалось убрать иконку'); } }}>Убрать иконку</button>
      {localIconPreview && <button type="button" disabled={busy} onClick={() => { saveLocalIcon(id, null); setMessage('Возвращена исходная иконка'); }}>Вернуть исходную</button>}
    </div>
    <small>SVG, PNG или WebP до 3 МБ. SVG преобразуется в PNG для безопасного отображения. Прозрачность сохраняется, изображение вписывается без обрезки.</small>
    <p role="status">{busy ? 'Подготовка иконки…' : message}</p>
  </section>;
}

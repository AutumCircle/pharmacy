'use client';

import { useRef, useState } from 'react';

export default function MedicineImageEditor({ medicineId, medicineName, initialUrl }: {
  medicineId: number; medicineName: string; initialUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function persist(nextUrl: string | null) {
    const response = await fetch(`/api/admin/medicines/${medicineId}/image`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: nextUrl }),
    });
    if (!response.ok) throw new Error('Не удалось сохранить');
    setImageUrl(nextUrl);
  }

  async function upload(file: File) {
    setBusy(true); setMessage('');
    try {
      const form = new FormData(); form.set('file', file); form.set('scope', 'products');
      const uploaded = await fetch('/api/admin/media/images', { method: 'POST', body: form });
      const payload = await uploaded.json() as { url?: string; error?: string };
      if (!uploaded.ok || !payload.url) throw new Error(payload.error || 'Не удалось загрузить');
      await persist(payload.url);
      setMessage('Сохранено');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка загрузки');
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  async function remove() {
    setBusy(true); setMessage('');
    try { await persist(null); setMessage('Удалено'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Ошибка'); }
    finally { setBusy(false); }
  }

  return <div className="admin-medicine-image-editor">
    <div className="admin-medicine-thumb">
      {imageUrl ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={imageUrl} alt={medicineName} referrerPolicy="no-referrer" /></> : <span>Нет фото</span>}
    </div>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <div><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
      {busy ? 'Подождите…' : imageUrl ? 'Заменить' : 'Добавить фото'}</button>
      {imageUrl && <button type="button" className="remove" disabled={busy} onClick={() => void remove()}>Удалить</button>}</div>
    {message && <small role="status">{message}</small>}
  </div>;
}

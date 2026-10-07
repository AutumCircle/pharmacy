'use client';

import { useRef, useState } from 'react';

export default function MedicineImageEditor({ medicineId, medicineName, initialUrl, enabled = true }: {
  medicineId: number; medicineName: string; initialUrl: string | null; enabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [urlDraft, setUrlDraft] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function persist(nextUrl: string | null) {
    const response = await fetch(`/api/admin/medicines/${medicineId}/image`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url: nextUrl }),
    });
    if (!response.ok) throw new Error('Не удалось сохранить');
    setImageUrl(nextUrl);
    setUrlDraft(nextUrl ?? '');
  }

  async function saveUrl() {
    const nextUrl = urlDraft.trim();
    setMessage('');
    if (!nextUrl) {
      setMessage('Вставьте прямую ссылку на изображение');
      return;
    }
    try {
      const parsed = new URL(nextUrl);
      if (parsed.protocol !== 'https:') throw new Error();
    } catch {
      setMessage('Нужна корректная HTTPS-ссылка');
      return;
    }
    setBusy(true);
    try {
      await persist(nextUrl);
      setMessage('Ссылка сохранена');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
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
      {imageUrl ? (
        // Admin-validated HTTPS media may use different CDN hosts.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={medicineName} referrerPolicy="no-referrer" />
      ) : <span>Нет фото</span>}
    </div>
    <label className="admin-medicine-image-url">
      <span>Ссылка на изображение</span>
      <input
        type="url"
        inputMode="url"
        value={urlDraft}
        maxLength={2000}
        placeholder="https://.../photo.jpg"
        disabled={busy || !enabled}
        onChange={(event) => { setUrlDraft(event.target.value); setMessage(''); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void saveUrl(); }
        }}
      />
    </label>
    <button className="admin-medicine-save-url" type="button" disabled={busy || !enabled || !urlDraft.trim()} onClick={() => void saveUrl()}>
      {busy ? 'Сохраняем…' : 'Сохранить ссылку'}
    </button>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <div><button type="button" disabled={busy || !enabled} onClick={() => inputRef.current?.click()}>
      Загрузить файл</button>
      {imageUrl && <button type="button" className="remove" disabled={busy || !enabled} onClick={() => void remove()}>Удалить</button>}</div>
    {!enabled && <small>Доступно после утверждения backend</small>}
    {message && <small role="status">{message}</small>}
  </div>;
}

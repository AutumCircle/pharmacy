'use client';

import { useState } from 'react';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import { saveHomepageBanner } from './actions';

const slotNames: Record<AdminHomepageBanner['slot'], string> = {
  left: 'Левый баннер',
  center: 'Центральный баннер',
  right_top: 'Правый верхний баннер',
  right_bottom: 'Правый нижний баннер',
};

function nullable(value: string): string | null {
  const clean = value.trim();
  return clean || null;
}

async function optimizeBannerImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог обработать изображение');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error('Браузер не смог подготовить WebP');
  if (blob.size > 3 * 1024 * 1024) throw new Error('После обработки изображение больше 3 МБ');
  return new File([blob], 'banner.webp', { type: 'image/webp' });
}

function BannerEditor({ initialBanner }: { initialBanner: AdminHomepageBanner }) {
  const [banner, setBanner] = useState(initialBanner);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const setField = <K extends keyof AdminHomepageBanner>(field: K, value: AdminHomepageBanner[K]) => {
    setBanner((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const result = await saveHomepageBanner({
      slot: banner.slot,
      title: banner.title.trim(),
      subtitle: nullable(banner.subtitle || ''),
      image_url: nullable(banner.image_url || ''),
      link_url: nullable(banner.link_url || ''),
      is_active: banner.is_active,
    });
    if (result.success) {
      setBanner(result.banner);
      setMessage('Сохранено');
    } else {
      setMessage(result.error || 'Ошибка сохранения');
    }
    setSaving(false);
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const optimized = await optimizeBannerImage(file);
      const form = new FormData();
      form.set('file', optimized);
      form.set('scope', 'banners');
      const response = await fetch('/api/admin/media/images', { method: 'POST', body: form });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || 'Не удалось загрузить изображение');
      const result = await saveHomepageBanner({
        slot: banner.slot,
        title: banner.title.trim(),
        subtitle: nullable(banner.subtitle || ''),
        image_url: payload.url,
        link_url: nullable(banner.link_url || ''),
        is_active: banner.is_active,
      });
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить баннер');
      setBanner(result.banner);
      setMessage('Изображение загружено и сохранено');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить изображение');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ background: 'white', border: '1px solid #e6e6e6', borderRadius: 14, padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>{slotNames[banner.slot]}</h2>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={banner.is_active} onChange={(event) => setField('is_active', event.target.checked)} />
          Показывать
        </label>
      </div>

      <div style={{ height: 180, borderRadius: 10, overflow: 'hidden', border: '1px solid #eee', background: '#f5f5f5', marginBottom: 18, position: 'relative' }}>
        {banner.image_url ? (
          // The URL is saved only after HTTPS validation in Lambda.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner.image_url} alt="Предпросмотр баннера" referrerPolicy="no-referrer" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#888' }}>Изображение не задано</div>
        )}
      </div>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Заголовок</span>
        <input required maxLength={120} value={banner.title} onChange={(event) => setField('title', event.target.value)} style={inputStyle} />
      </label>
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Подзаголовок</span>
        <textarea maxLength={240} rows={2} value={banner.subtitle || ''} onChange={(event) => setField('subtitle', event.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
      </label>
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Загрузить изображение с компьютера</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void uploadImage(event.target.files?.[0])} style={inputStyle} />
        <small style={{ display: 'block', color: '#777', marginTop: 5 }}>JPEG, PNG или WebP, максимум 3 МБ. После загрузки баннер сохраняется автоматически.</small>
      </label>
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>HTTPS-ссылка на изображение</span>
        <input type="url" placeholder="https://..." value={banner.image_url || ''} onChange={(event) => setField('image_url', event.target.value)} style={inputStyle} />
      </label>
      <label style={{ display: 'block', marginBottom: 18 }}>
        <span style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Ссылка при нажатии</span>
        <input placeholder="/catalog или https://..." value={banner.link_url || ''} onChange={(event) => setField('link_url', event.target.value)} style={inputStyle} />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="submit" disabled={saving || uploading} style={{ border: 0, borderRadius: 8, padding: '10px 18px', background: 'var(--primary)', color: 'white', fontWeight: 600, cursor: saving || uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Загрузка...' : saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        {message && <span style={{ color: message === 'Сохранено' ? '#16803a' : '#b42318', fontSize: 14 }}>{message}</span>}
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  border: '1px solid #d8d8d8',
  borderRadius: 8,
  font: 'inherit',
  boxSizing: 'border-box',
};

export default function BannersClient({ banners }: { banners: AdminHomepageBanner[] }) {
  return (
    <div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Баннеры главной страницы</h1>
      <p style={{ margin: '0 0 24px', color: '#666', maxWidth: 760 }}>
        Загрузите изображение с компьютера — оно будет сохранено в AWS и сразу привязано к баннеру. HTTPS-ссылку также можно указать вручную.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {banners.map((banner) => <BannerEditor key={banner.slot} initialBanner={banner} />)}
      </div>
    </div>
  );
}

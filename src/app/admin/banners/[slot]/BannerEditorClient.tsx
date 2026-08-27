'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import { saveHomepageBanner } from '../actions';
import BannerAdminPreview from '../BannerAdminPreview';
import { bannerRecommendedDimensions, bannerSlotNames } from '../banner-config';

function nullable(value: string | null): string | null {
  const clean = value?.trim() || '';
  return clean || null;
}

async function prepareBannerImage(file: File): Promise<{ file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, 1920 / width, 1920 / height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Браузер не смог обработать изображение');
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (!blob) throw new Error('Браузер не смог подготовить WebP');
  if (blob.size > 3 * 1024 * 1024) throw new Error('После обработки изображение больше 3 МБ');
  return { file: new File([blob], 'banner.webp', { type: 'image/webp' }), width, height };
}

export default function BannerEditorClient({ initialBanner }: { initialBanner: AdminHomepageBanner }) {
  const [saved, setSaved] = useState(initialBanner);
  const [draft, setDraft] = useState(initialBanner);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setField = <K extends keyof AdminHomepageBanner>(field: K, value: AdminHomepageBanner[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setMessage('');
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const prepared = await prepareBannerImage(file);
      const form = new FormData();
      form.set('file', prepared.file);
      form.set('scope', 'banners');
      const response = await fetch('/api/admin/media/images', { method: 'POST', body: form });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || 'Не удалось загрузить изображение');
      setDraft((current) => ({ ...current, image_url: payload.url || null, image_width: prepared.width, image_height: prepared.height }));
      setMessage('Изображение загружено. Нажмите «Сохранить изменения».');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось загрузить изображение');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.is_active && !draft.image_url) {
      setMessage('Для активного баннера необходимо изображение. Оставьте его черновиком или загрузите изображение.');
      return;
    }
    setSaving(true);
    setMessage('');
    const { updated_at: savedTimestamp, ...editable } = draft;
    void savedTimestamp;
    const result = await saveHomepageBanner({
      ...editable,
      title: nullable(draft.title),
      subtitle: nullable(draft.subtitle),
      cta_text: nullable(draft.cta_text),
      alt_text: nullable(draft.alt_text),
      image_url: nullable(draft.image_url),
      link_url: nullable(draft.link_url),
    });
    if (result.success) {
      setSaved(result.banner);
      setDraft(result.banner);
      setMessage('Изменения сохранены');
    } else {
      setMessage(result.error || 'Не удалось сохранить баннер');
    }
    setSaving(false);
  };

  const removeImage = () => {
    setDraft((current) => ({ ...current, image_url: null, image_width: null, image_height: null, is_active: false }));
    setMessage('Изображение убрано, баннер переведён в черновик. Сохраните изменения.');
  };

  const reset = () => {
    setDraft(saved);
    setMessage('Изменения отменены');
  };

  return (
    <form className="admin-banner-editor-page" onSubmit={submit}>
      <div className="admin-banner-editor-toolbar">
        <Link href="/admin/banners" onClick={(event) => {
          if (dirty && !window.confirm('Есть несохранённые изменения. Выйти без сохранения?')) event.preventDefault();
        }}>← Все баннеры</Link>
        <div className="admin-banner-editor-actions">
          <span className={`admin-banner-unsaved ${dirty ? 'is-dirty' : ''}`}>{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span>
          <button type="button" className="admin-secondary-button" onClick={reset} disabled={!dirty || saving || uploading}>Отменить изменения</button>
          <button type="submit" className="admin-primary-button" disabled={!dirty || saving || uploading}>{saving ? 'Сохранение…' : 'Сохранить изменения'}</button>
        </div>
      </div>

      <div className="admin-banner-editor-heading">
        <div><span className="admin-banner-slot-code">{draft.slot}</span><h1>{bannerSlotNames[draft.slot]}</h1></div>
        <label className="admin-banner-active-toggle"><input type="checkbox" checked={draft.is_active} onChange={(event) => setField('is_active', event.target.checked)} />{draft.is_active ? 'Активен' : 'Черновик'}</label>
      </div>

      <section className="admin-banner-editor-preview-panel">
        <div className="admin-banner-preview-toolbar">
          <div className="admin-banner-mode-switch" role="group" aria-label="Режим предпросмотра">
            <button type="button" className={previewMode === 'desktop' ? 'is-active' : ''} onClick={() => setPreviewMode('desktop')}>Desktop</button>
            <button type="button" className={previewMode === 'mobile' ? 'is-active' : ''} onClick={() => setPreviewMode('mobile')}>Mobile</button>
          </div>
          <span>Пунктир показывает безопасную область для важного текста.</span>
        </div>
        <div className={`admin-banner-preview-stage is-${previewMode}`}><BannerAdminPreview banner={draft} mode={previewMode} showSafeRegion /></div>
      </section>

      <div className="admin-banner-settings-grid">
        <section className="admin-banner-settings-card">
          <h2>Изображение</h2>
          <p className="admin-control-note">Рекомендуемый размер: {bannerRecommendedDimensions[draft.slot]}. Исходный: {draft.image_width && draft.image_height ? `${draft.image_width} × ${draft.image_height} px` : 'неизвестен'}.</p>
          <label className="admin-field"><span>Загрузить или заменить</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void uploadImage(event.target.files?.[0])} /></label>
          <div className="admin-inline-actions"><button type="button" className="admin-secondary-button" onClick={removeImage} disabled={!draft.image_url || uploading}>Убрать изображение</button>{uploading && <span>Загрузка…</span>}</div>
          <label className="admin-field"><span>HTTPS-ссылка</span><input type="url" value={draft.image_url || ''} onChange={(event) => setDraft((current) => ({ ...current, image_url: nullable(event.target.value), image_width: null, image_height: null }))} placeholder="https://…" /></label>
          <label className="admin-field"><span>Alt text</span><input maxLength={200} value={draft.alt_text || ''} onChange={(event) => setField('alt_text', event.target.value)} placeholder="Кратко опишите изображение" /></label>
          <label className="admin-field"><span>Режим изображения</span><select value={draft.fit_mode} onChange={(event) => setField('fit_mode', event.target.value as AdminHomepageBanner['fit_mode'])}><option value="cover">Cover — заполнить с обрезкой</option><option value="contain">Contain — показать полностью</option></select></label>
          <label className="admin-range-field"><span>Фокус X: {draft.object_position_x}%</span><input type="range" min="0" max="100" value={draft.object_position_x} onChange={(event) => setField('object_position_x', Number(event.target.value))} /></label>
          <label className="admin-range-field"><span>Фокус Y: {draft.object_position_y}%</span><input type="range" min="0" max="100" value={draft.object_position_y} onChange={(event) => setField('object_position_y', Number(event.target.value))} /></label>
        </section>

        <section className="admin-banner-settings-card">
          <h2>Текст и CTA</h2>
          <label className="admin-field"><span>Заголовок <small>необязательно</small></span><input maxLength={120} value={draft.title || ''} onChange={(event) => setField('title', event.target.value)} /></label>
          <label className="admin-field"><span>Подзаголовок <small>необязательно</small></span><textarea rows={3} maxLength={240} value={draft.subtitle || ''} onChange={(event) => setField('subtitle', event.target.value)} /></label>
          <label className="admin-field"><span>Текст кнопки CTA</span><input maxLength={80} value={draft.cta_text || ''} onChange={(event) => setField('cta_text', event.target.value)} /></label>
          <label className="admin-field"><span>Ссылка CTA</span><input value={draft.link_url || ''} onChange={(event) => setField('link_url', event.target.value)} placeholder="/catalog или https://…" /></label>
          <div className="admin-two-column-controls">
            <label className="admin-field"><span>Цвет текста</span><input type="color" value={draft.text_color} onChange={(event) => setField('text_color', event.target.value.toUpperCase())} /></label>
            <label className="admin-field"><span>Выравнивание</span><select value={draft.text_align} onChange={(event) => setField('text_align', event.target.value as AdminHomepageBanner['text_align'])}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select></label>
            <label className="admin-field"><span>Положение</span><select value={draft.content_vertical} onChange={(event) => setField('content_vertical', event.target.value as AdminHomepageBanner['content_vertical'])}><option value="top">Сверху</option><option value="center">По центру</option><option value="bottom">Снизу</option></select></label>
            <label className="admin-field"><span>Max-width: {draft.content_max_width}%</span><input type="range" min="30" max="100" value={draft.content_max_width} onChange={(event) => setField('content_max_width', Number(event.target.value))} /></label>
            <label className="admin-field"><span>Заголовок: {draft.title_size}px</span><input type="range" min="14" max="64" value={draft.title_size} onChange={(event) => setField('title_size', Number(event.target.value))} /></label>
            <label className="admin-field"><span>Подзаголовок: {draft.subtitle_size}px</span><input type="range" min="10" max="40" value={draft.subtitle_size} onChange={(event) => setField('subtitle_size', Number(event.target.value))} /></label>
          </div>
        </section>

        <section className="admin-banner-settings-card">
          <h2>Overlay</h2>
          <label className="admin-checkbox-field"><input type="checkbox" checked={draft.overlay_enabled} onChange={(event) => setField('overlay_enabled', event.target.checked)} /><span>Включить overlay</span></label>
          <div className={draft.overlay_enabled ? '' : 'admin-controls-disabled'}>
            <label className="admin-field"><span>Тип</span><select disabled={!draft.overlay_enabled} value={draft.overlay_type} onChange={(event) => setField('overlay_type', event.target.value as AdminHomepageBanner['overlay_type'])}><option value="gradient">Градиент</option><option value="solid">Сплошной</option></select></label>
            <label className="admin-field"><span>Цвет</span><input disabled={!draft.overlay_enabled} type="color" value={draft.overlay_color} onChange={(event) => setField('overlay_color', event.target.value.toUpperCase())} /></label>
            <label className="admin-range-field"><span>Прозрачность: {draft.overlay_opacity}%</span><input disabled={!draft.overlay_enabled} type="range" min="0" max="100" value={draft.overlay_opacity} onChange={(event) => setField('overlay_opacity', Number(event.target.value))} /></label>
            <label className="admin-field"><span>Направление</span><select disabled={!draft.overlay_enabled || draft.overlay_type === 'solid'} value={draft.overlay_direction} onChange={(event) => setField('overlay_direction', event.target.value as AdminHomepageBanner['overlay_direction'])}><option value="to_right">Слева направо</option><option value="to_left">Справа налево</option><option value="to_bottom">Сверху вниз</option><option value="to_top">Снизу вверх</option></select></label>
          </div>
        </section>
      </div>

      <div className="admin-banner-editor-footer"><span>Последнее сохранение: {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(saved.updated_at))}</span>{message && <strong className={message.includes('сохранен') ? 'is-success' : ''}>{message}</strong>}</div>
    </form>
  );
}

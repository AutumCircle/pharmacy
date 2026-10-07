'use client';

import Link from 'next/link';
import { useState } from 'react';
import { previewCollectionProducts, removeCollection, saveCollection, setCollectionActive } from './actions';
import type { AdminCollection, AdminCollectionProduct } from '@/lib/api-v1/admin-types';
import { buildInstagramStoryUrl } from '@/lib/collections';

type Draft = { id: number | null; slug: string; title: string; description: string; productIds: string; isActive: boolean };
type Preview = { products: AdminCollectionProduct[]; missing: number[]; error: string | null };

const EMPTY: Draft = { id: null, slug: '', title: '', description: '', productIds: '', isActive: true };
const field = { width: '100%', padding: '9px 10px', border: '1px solid #d0d5dd', borderRadius: 8, boxSizing: 'border-box' } as const;

function toDraft(collection: AdminCollection): Draft {
  return {
    id: collection.id, slug: collection.slug, title: collection.title, description: collection.description,
    productIds: collection.product_ids.join(', '), isActive: collection.is_active,
  };
}

function StoryLinks({ collection, siteUrl }: { collection: AdminCollection; siteUrl: string }) {
  const [open, setOpen] = useState(false);
  const [campaign, setCampaign] = useState(`story-${collection.slug}`);
  const [copied, setCopied] = useState<string | null>(null);

  const trackedLink = (path: string, content: string) => (
    buildInstagramStoryUrl(siteUrl, path, campaign, content)
  );
  const copy = async (label: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(label);
    } catch {
      window.prompt('Скопируйте ссылку', link);
    }
  };

  return (
    <div className="collection-story-links">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? 'Скрыть UTM-ссылки' : 'Ссылки для сторис'}
      </button>
      {open && (
        <div className="collection-story-links__panel">
          <div>
            <strong>Отдельные ссылки для Instagram Stories</strong>
            <p>Задайте название конкретной сториз. В заказе будет видно это название и выбранный товар или подборку.</p>
          </div>
          <label>
            Название сториз или кампании
            <input
              value={campaign}
              maxLength={100}
              onChange={(event) => { setCampaign(event.target.value); setCopied(null); }}
              placeholder="Например: oct7-evening"
            />
          </label>
          <div className="collection-story-links__rows">
            <div>
              <span><strong>Вся подборка</strong><small>content: collection_{collection.slug}</small></span>
              <button
                type="button"
                disabled={!campaign.trim()}
                onClick={() => void copy(
                  'collection',
                  trackedLink(`/podborka/${collection.slug}`, `collection_${collection.slug}`),
                )}
              >
                {copied === 'collection' ? 'Скопировано ✓' : 'Скопировать'}
              </button>
            </div>
            {collection.products.map((product) => (
              <div key={product.id}>
                <span>
                  <strong>{product.name ?? `Товар ${product.id}`}</strong>
                  <small>content: product_{product.id}</small>
                </span>
                <button
                  type="button"
                  disabled={!campaign.trim() || !product.name}
                  onClick={() => void copy(
                    `product-${product.id}`,
                    trackedLink(`/medicine/${product.id}`, `product_${product.id}`),
                  )}
                >
                  {copied === `product-${product.id}` ? 'Скопировано ✓' : 'Скопировать'}
                </button>
              </div>
            ))}
          </div>
          <small className="collection-story-links__note">
            Источник будет записан как Instagram / story. Если клиент откроет несколько рекламных ссылок, заказ относится к последней открытой ссылке.
          </small>
        </div>
      )}
    </div>
  );
}

export default function CollectionsClient({ initialCollections, siteUrl }: { initialCollections: AdminCollection[]; siteUrl: string }) {
  const [collections, setCollections] = useState(initialCollections);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const linkFor = (slug: string) => `${siteUrl}/podborka/${slug}`;

  const copyLink = async (slug: string) => {
    const link = linkFor(slug);
    try {
      await navigator.clipboard.writeText(link);
      setMessage({ kind: 'ok', text: `Ссылка скопирована: ${link}` });
    } catch {
      window.prompt('Скопируйте ссылку', link);
    }
  };

  const openDraft = (next: Draft) => {
    setDraft(next);
    setPreview(null);
    setMessage(null);
    if (next.productIds.trim()) void checkProducts(next.productIds);
  };

  const checkProducts = async (rawIds: string) => {
    const result = await previewCollectionProducts(rawIds);
    if (!result.success) setPreview({ products: [], missing: [], error: result.error });
    else setPreview({ products: result.products, missing: result.missing_ids, error: null });
  };

  const apply = (result: { success: true; collections: AdminCollection[] } | { success: false; error: string }, okText: string) => {
    if (result.success) {
      setCollections(result.collections);
      setMessage({ kind: 'ok', text: okText });
      return true;
    }
    setMessage({ kind: 'error', text: result.error });
    return false;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const result = await saveCollection(draft.id, {
      slug: draft.slug, title: draft.title, description: draft.description,
      productIds: draft.productIds, isActive: draft.isActive,
    });
    if (apply(result, 'Подборка сохранена')) setDraft(null);
    setBusy(false);
  };

  const toggle = async (collection: AdminCollection) => {
    setBusy(true);
    apply(await setCollectionActive(collection.id, !collection.is_active), collection.is_active ? 'Подборка выключена' : 'Подборка включена');
    setBusy(false);
  };

  const remove = async (collection: AdminCollection) => {
    if (!window.confirm(`Удалить подборку «${collection.title}»? Ссылка перестанет открываться. Статистика сохранится.`)) return;
    setBusy(true);
    apply(await removeCollection(collection.id), 'Подборка удалена');
    setBusy(false);
  };

  const productIdsByName = (id: number) => preview?.products.find((product) => product.id === id);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Подборки товаров</h1>
        <button type="button" disabled={busy} onClick={() => openDraft(EMPTY)} style={{ padding: '10px 18px' }}>Новая подборка</button>
      </div>
      <p style={{ color: '#667085' }}>
        Создайте подборку, затем откройте «Ссылки для сторис»: админка подготовит отдельную отслеживаемую ссылку для подборки и каждого товара.
        Рецептурные препараты в подборки добавлять нельзя.
      </p>
      {message && (
        <div role="status" style={{ margin: '12px 0', padding: 12, borderRadius: 8, background: message.kind === 'ok' ? '#e8f5e9' : '#fdecea', color: message.kind === 'ok' ? '#1b5e20' : '#b71c1c' }}>
          {message.text}
        </div>
      )}

      {draft && (
        <form onSubmit={submit} style={{ background: 'white', border: '1px solid #e4e7ec', borderRadius: 12, padding: 20, margin: '16px 0', display: 'grid', gap: 14 }}>
          <h2 style={{ margin: 0 }}>{draft.id === null ? 'Новая подборка' : 'Редактирование подборки'}</h2>
          <label>Адрес (slug), например oct-6
            <input style={field} value={draft.slug} required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Маленькие латинские буквы, цифры и дефисы"
              onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase() })} />
          </label>
          <label>Заголовок
            <input style={field} value={draft.title} required minLength={2} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>Короткий текст
            <textarea style={{ ...field, minHeight: 70 }} value={draft.description} maxLength={1000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <label>ID товаров через запятую (порядок сохраняется)
            <input style={field} value={draft.productIds} inputMode="numeric" placeholder="10059, 4048, 8955"
              onChange={(event) => setDraft({ ...draft, productIds: event.target.value })}
              onBlur={(event) => { if (event.target.value.trim()) void checkProducts(event.target.value); else setPreview(null); }} />
          </label>
          {preview?.error && <div style={{ color: '#b71c1c' }}>{preview.error}</div>}
          {preview && !preview.error && (
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
              {draft.productIds.split(/[\s,;]+/).filter(Boolean).map((raw, index) => {
                const id = Number(raw);
                const product = productIdsByName(id);
                return (
                  <li key={`${raw}-${index}`} style={{ color: product ? '#1b5e20' : '#b71c1c' }}>
                    {raw}: {product ? `${product.name}${product.in_stock ? '' : ' (нет в наличии)'}` : 'товар не найден в каталоге'}
                  </li>
                );
              })}
            </ol>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
            Подборка включена (ссылка открывается)
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={busy} style={{ padding: '10px 18px' }}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)} style={{ padding: '10px 18px' }}>Отмена</button>
          </div>
        </form>
      )}

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {collections.length === 0 && <div style={{ padding: 30, textAlign: 'center', background: 'white', borderRadius: 12 }}>Подборок пока нет</div>}
        {collections.map((collection) => (
          <article key={collection.id} style={{ background: 'white', border: '1px solid #e4e7ec', borderRadius: 12, padding: 16, opacity: collection.is_active ? 1 : 0.7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: '0 0 4px' }}>{collection.title} <span style={{ fontWeight: 400, color: '#667085' }}>· /podborka/{collection.slug}</span></h3>
                <div style={{ color: collection.is_active ? '#1b5e20' : '#b71c1c', fontWeight: 600 }}>{collection.is_active ? 'Включена' : 'Выключена'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <button type="button" onClick={() => void copyLink(collection.slug)}>Скопировать ссылку</button>
                <a href={linkFor(collection.slug)} target="_blank" rel="noreferrer">Открыть</a>
                <Link href={`/admin/collection-stats?slug=${encodeURIComponent(collection.slug)}`}>Статистика</Link>
                <button type="button" disabled={busy} onClick={() => openDraft(toDraft(collection))}>Изменить</button>
                <button type="button" disabled={busy} onClick={() => void toggle(collection)}>{collection.is_active ? 'Выключить' : 'Включить'}</button>
                <button type="button" disabled={busy} onClick={() => void remove(collection)} style={{ color: '#b71c1c' }}>Удалить</button>
              </div>
            </div>
            {collection.description && <p style={{ margin: '8px 0', color: '#475467' }}>{collection.description}</p>}
            <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {collection.products.map((product) => (
                <li key={product.id}>{product.id}: {product.name ?? 'товар не найден'}{product.name && !product.in_stock ? ' (нет в наличии)' : ''}</li>
              ))}
              {collection.products.length === 0 && <li style={{ listStyle: 'none', color: '#b71c1c' }}>Товаров нет</li>}
            </ol>
            <StoryLinks collection={collection} siteUrl={siteUrl} />
          </article>
        ))}
      </div>
    </div>
  );
}

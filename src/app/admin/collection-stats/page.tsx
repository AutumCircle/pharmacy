import Link from 'next/link';
import { Fragment } from 'react';
import { requireAdminSession } from '@/lib/admin-auth';
import { getAdminCollectionStats } from '@/lib/api-v1/admin-server';
import type { CollectionStats, CollectionStatsTotals } from '@/lib/api-v1/admin-types';
import ResetCollectionStats from './ResetCollectionStats';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ from?: string; to?: string; slug?: string }>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const cell = { padding: '8px 10px', textAlign: 'right' } as const;
const money = (value: number | string) => `${Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} с.`;

function Totals({ row }: { row: CollectionStatsTotals }) {
  return (
    <>
      <td style={cell}>{row.views}</td>
      <td style={cell}>{row.unique_visitors}</td>
      <td style={cell}>{row.product_opens}</td>
      <td style={cell}>{row.add_to_carts}</td>
      <td style={cell}>{row.orders}</td>
      <td style={cell}>{money(row.orders_total)}</td>
    </>
  );
}

export default async function CollectionStatsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminSession();
  const params = await searchParams;
  const from = params.from && DATE_PATTERN.test(params.from) ? params.from : undefined;
  const to = params.to && DATE_PATTERN.test(params.to) ? params.to : undefined;
  const slug = params.slug && /^[a-z0-9-]{1,80}$/.test(params.slug) ? params.slug : undefined;

  let stats: CollectionStats | null = null;
  let error: string | null = null;
  try {
    stats = (await getAdminCollectionStats({ from, to, slug })).data;
  } catch (cause) {
    console.error('Failed to load collection statistics', cause);
    error = cause instanceof Error ? cause.message : 'Не удалось загрузить статистику';
  }
  const keep = (values: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    Object.entries({ from, to, ...values }).forEach(([key, value]) => { if (value) query.set(key, value); });
    const text = query.toString();
    return `/admin/collection-stats${text ? `?${text}` : ''}`;
  };
  const selected = stats?.collections.find((collection) => collection.slug === slug);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Статистика подборок</h1>
      <form method="get" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '16px 0' }}>
        {slug && <input type="hidden" name="slug" value={slug} />}
        <label>С <input type="date" name="from" defaultValue={from} style={{ padding: 8 }} /></label>
        <label>По <input type="date" name="to" defaultValue={to} style={{ padding: 8 }} /></label>
        <button type="submit" style={{ padding: '9px 16px' }}>Показать</button>
        <Link href={keep({ from: undefined, to: undefined, slug })} style={{ padding: '9px 4px' }}>Сбросить даты</Link>
      </form>
      <p style={{ color: '#667085', marginTop: 0 }}>
        Даты по времени Душанбе. «Открытия» — загрузки страницы в браузере (боты и предпросмотры не считаются), «Уникальные» — разные анонимные посетители.
        В заказы входят неудалённые и неотменённые заказы.
      </p>
      {error && <div style={{ background: '#fdecea', color: '#b71c1c', padding: 14, borderRadius: 8 }}>{error}. Проверьте, что миграция 0019 применена, а Admin Lambda обновлена.</div>}

      <ResetCollectionStats />

      {stats && (
        <>
          <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Подборка</th><th style={cell}>Открытия</th><th style={cell}>Уникальные</th><th style={cell}>Переходы в товары</th>
                  <th style={cell}>В корзину</th><th style={cell}>Заказы</th><th style={cell}>Сумма заказов</th>
                </tr>
              </thead>
              <tbody>
                {stats.collections.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>Подборок пока нет</td></tr>}
                {stats.collections.map((collection) => (
                  <Fragment key={collection.slug}>
                    <tr style={collection.slug === slug ? { background: '#f5f9ff' } : undefined}>
                      <td>
                        <Link href={keep({ slug: collection.slug })}><strong>{collection.title}</strong></Link>
                        <div style={{ color: '#667085', fontSize: 12 }}>
                          {collection.slug}{collection.deleted ? ' · удалена' : collection.is_active ? '' : ' · выключена'}
                        </div>
                      </td>
                      <Totals row={collection} />
                    </tr>
                    {collection.by_medium.map((medium) => (
                      <tr key={`${collection.slug}-${medium.medium ?? 'none'}`} style={{ color: '#475467', fontSize: 13 }}>
                        <td style={{ paddingLeft: 28 }}>utm_medium: {medium.medium ?? 'не указан'}</td>
                        <Totals row={medium} />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {slug && stats.products && (
            <section style={{ marginTop: 28 }}>
              <h2>Товары подборки {selected ? `«${selected.title}»` : slug}</h2>
              <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12 }}>
                <table className="admin-table">
                  <thead>
                    <tr><th>Товар</th><th style={cell}>Переходы в товар</th><th style={cell}>В корзину</th><th style={cell}>Заказы</th><th style={cell}>Сумма заказов</th></tr>
                  </thead>
                  <tbody>
                    {stats.products.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>Нет данных</td></tr>}
                    {stats.products.map((product) => (
                      <tr key={product.product_id}>
                        <td>{product.product_id}: {product.name ?? 'товар не найден'}{product.in_collection ? '' : ' (уже не в подборке)'}</td>
                        <td style={cell}>{product.product_opens}</td>
                        <td style={cell}>{product.add_to_carts}</td>
                        <td style={cell}>{product.orders}</td>
                        <td style={cell}>{money(product.orders_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p><Link href={keep({ slug: undefined })}>← Ко всем подборкам</Link></p>
            </section>
          )}

          <section style={{ marginTop: 28 }}>
            <h2>Переходы по ссылкам из сторис</h2>
            <p style={{ color: '#667085', marginTop: 0 }}>
              Реальные загрузки страниц по UTM-ссылкам. Предпросмотры Instagram и известные боты не учитываются.
            </p>
            <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Сторис / кампания</th><th>Товар или ссылка</th><th>Источник</th>
                    <th style={cell}>Переходы</th><th style={cell}>Уникальные</th>
                    <th style={cell}>Заказы</th><th style={cell}>Сумма заказов</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.utm_links.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>Переходов пока нет</td></tr>}
                  {stats.utm_links.map((row, index) => (
                    <tr key={`${row.utm_campaign}-${row.utm_content}-${row.product_id ?? 'link'}-${index}`}>
                      <td><strong>{row.utm_campaign || 'Без названия'}</strong><div style={{ color: '#667085', fontSize: 12 }}>{row.utm_content || '—'}</div></td>
                      <td>
                        {row.product_id ? (
                          <Link href={`/medicine/${row.product_id}`} target="_blank">
                            {row.product_name ?? `Товар ${row.product_id}`}
                          </Link>
                        ) : row.utm_content || 'Ссылка'}
                      </td>
                      <td>{[row.utm_source, row.utm_medium].filter(Boolean).join(' / ') || '—'}</td>
                      <td style={cell}>{row.views}</td><td style={cell}>{row.unique_visitors}</td>
                      <td style={cell}>{row.orders}</td><td style={cell}>{money(row.orders_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginTop: 28 }}>
            <h2>Заказы с UTM без подборки</h2>
            <p style={{ color: '#667085', marginTop: 0 }}>Например, сторис со ссылкой прямо на товар. Сгруппировано по utm_content.</p>
            <div style={{ overflowX: 'auto', background: 'white', borderRadius: 12 }}>
              <table className="admin-table">
                <thead>
                  <tr><th>utm_content</th><th>utm_source</th><th>utm_medium</th><th>utm_campaign</th><th style={cell}>Заказы</th><th style={cell}>Сумма заказов</th></tr>
                </thead>
                <tbody>
                  {stats.utm_orders.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>Таких заказов нет</td></tr>}
                  {stats.utm_orders.map((row, index) => (
                    <tr key={`${row.utm_content}-${row.utm_source}-${row.utm_medium}-${row.utm_campaign}-${index}`}>
                      <td>{row.utm_content || '—'}</td><td>{row.utm_source || '—'}</td><td>{row.utm_medium || '—'}</td><td>{row.utm_campaign || '—'}</td>
                      <td style={cell}>{row.orders}</td><td style={cell}>{money(row.orders_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

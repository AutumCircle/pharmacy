import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin-auth';
import { getMirrorStatus, searchMirrorProducts } from '@/lib/api-v1/pharmacy-mirror-server';
import { mirrorTime, mirrorQuantity, mirrorSearchError } from '@/lib/pharmacy-mirror';
import Refresh from './Refresh';
import Help from './Help';
import { Pager, ReadOnly, Prices } from './parts';

export const dynamic = 'force-dynamic';
export default async function MirrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const mode = typeof params.mode === 'string' ? params.mode : 'auto';
  const page =
    typeof params.page === 'string' && /^[1-9][0-9]{0,3}$/.test(params.page)
      ? Number(params.page)
      : 1;
  const validation = mirrorSearchError(q, mode);
  const [statusResult, productsResult] = await Promise.allSettled([
    getMirrorStatus(),
    q && !validation ? searchMirrorProducts(q, mode, page) : Promise.resolve(null),
  ]);
  const status = statusResult.status === 'fulfilled' ? statusResult.value : null;
  const products = productsResult.status === 'fulfilled' ? productsResult.value : null;
  const href = (p: number) =>
    `/admin/pharmacy-mirror?${new URLSearchParams({ q, mode, page: String(p) })}`;
  return (
    <>
      <header className="mirror-header">
        <div>
          <h1>База аптеки · Аптека №1</h1>
          <div className="mirror-inline">
            <ReadOnly />
            <Help topic="shadow" />
          </div>
        </div>
        <Refresh />
      </header>
      {status ? (
        <section className="mirror-panel mirror-connection" aria-label="Состояние зеркала">
          <div className="mirror-stats">
            <div>
              <span>
                Связь с аптекой <Help topic="connection" />
              </span>
              <strong
                className={status.freshness === 'current' ? 'mirror-online' : 'mirror-offline'}
              >
                {status.freshness === 'current' ? '● На связи' : '● Нет свежего сигнала'}
              </strong>
              <small>{mirrorTime(status.last_seen_at)}</small>
            </div>
            <div>
              <span>
                Изменения получены <Help topic="received" />
              </span>
              <strong>{mirrorTime(status.last_batch_at)}</strong>
            </div>
            <div>
              <span>Товаров в зеркале</span>
              <strong>
                {status.tables
                  .find((t) => t.table_name === 'T_PRODUCT')
                  ?.row_count.toLocaleString('ru-RU') ?? '—'}
              </strong>
            </div>
          </div>
          {status.freshness === 'stale' && (
            <p role="alert" className="mirror-warning">
              Давно не было связи с аптекой. Данные могут быть устаревшими.
            </p>
          )}
          <details className="mirror-technical">
            <summary>Техническая проверка синхронизации</summary>
            <p>
              В таблице указано время последнего изменения строк. Неизменившиеся справочники могут
              иметь старую дату даже при работающем агенте.
            </p>
            {status.last_batch && (
              <p className="mirror-meta">
                Последний пакет: {status.last_batch.batch_id} · {status.last_batch.table_name} ·
                Строк: {status.last_batch.upserted_count}
              </p>
            )}
            <div className="mirror-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Таблица</th>
                    <th>Строк</th>
                    <th>Номер изменения</th>
                    <th>Получено в AWS</th>
                    <th>Состояние</th>
                  </tr>
                </thead>
                <tbody>
                  {status.tables.map((t) => (
                    <tr key={t.table_name}>
                      <th scope="row">{t.table_name}</th>
                      <td>{t.row_count.toLocaleString('ru-RU')}</td>
                      <td>{t.max_change_id ?? 'нет в источнике'}</td>
                      <td>{mirrorTime(t.last_received_at)}</td>
                      <td>
                        {t.freshness === 'current' ? 'Недавно обновлялось' : 'Давно не менялось'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ) : (
        <p role="alert" className="mirror-warning">
          Не удалось получить состояние зеркала. Нажмите «Обновить данные».
        </p>
      )}
      <form action="/admin/pharmacy-mirror" className="mirror-search">
        <label>
          Поиск товара
          <input
            name="q"
            defaultValue={q}
            placeholder="Название, штрихкод или номер товара"
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label>
          Искать по
          <select name="mode" defaultValue={mode}>
            <option value="auto">Определить автоматически</option>
            <option value="name">Название</option>
            <option value="id">Номер товара</option>
            <option value="barcode">Штрихкод товара / поступления</option>
          </select>
        </label>
        <button type="submit">Найти</button>
      </form>
      {validation && <p role="alert">{validation}</p>}
      {productsResult.status === 'rejected' && (
        <p role="alert" className="mirror-warning">
          Поиск временно недоступен. Повторите попытку.
        </p>
      )}
      {!q && (
        <p className="mirror-empty">
          Найдите товар по названию, штрихкоду или номеру из «Алгоритма». Для названия достаточно
          двух букв.
        </p>
      )}
      {products && (
        <>
          <Pager total={products.total} page={products.page} href={href} />
          {products.items.length === 0 ? (
            <p role="status" className="mirror-empty">
              Товары не найдены. Проверьте запрос или тип поиска.
            </p>
          ) : (
            <>
              <div className="mirror-desktop mirror-table-wrap">
                <table className="mirror-results">
                  <thead>
                    <tr>
                      <th>
                        Товар <Help topic="productId" />
                      </th>
                      <th>Штрихкод</th>
                      <th>
                        Остаток <Help topic="stock" />
                      </th>
                      <th>Цены за единицу</th>
                      <th>Карточка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.items.map((p) => (
                      <tr key={p.product_id}>
                        <th scope="row">
                          <Link
                            className="mirror-product-name"
                            href={`/admin/pharmacy-mirror/products/${p.product_id}`}
                          >
                            {p.name}
                          </Link>
                          <small>{p.vendor || 'Производитель не указан'}</small>
                          <small>Номер товара: {p.product_id}</small>
                        </th>
                        <td className="mirror-barcode">{p.barcode || 'Не указан'}</td>
                        <td>
                          <strong className="mirror-stock-number">
                            {p.stock_rows === 0
                              ? 'Нет данных'
                              : mirrorQuantity(p.total_stock, p.stock_rows, p.invalid_stock_rows)}
                          </strong>
                        </td>
                        <td>
                          <Prices prices={p} />
                        </td>
                        <td>
                          <Link
                            className="mirror-open"
                            href={`/admin/pharmacy-mirror/products/${p.product_id}`}
                            aria-label={`Открыть ${p.name}`}
                          >
                            Открыть →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mirror-mobile">
                {products.items.map((p) => (
                  <article className="mirror-panel mirror-product-card" key={p.product_id}>
                    <h2>
                      <Link href={`/admin/pharmacy-mirror/products/${p.product_id}`}>{p.name}</Link>
                    </h2>
                    <p className="mirror-meta">{p.vendor || 'Производитель не указан'}</p>
                    <div className="mirror-card-stock">
                      <span>
                        Остаток <Help topic="stock" />
                      </span>
                      <strong>
                        {p.stock_rows === 0
                          ? 'Нет данных'
                          : mirrorQuantity(p.total_stock, p.stock_rows, p.invalid_stock_rows)}
                      </strong>
                    </div>
                    <Prices prices={p} />
                    <div className="mirror-card-footer">
                      <small>
                        Штрихкод: {p.barcode || 'не указан'}
                        <br />
                        Номер товара: {p.product_id}
                      </small>
                      <Link
                        className="mirror-open"
                        href={`/admin/pharmacy-mirror/products/${p.product_id}`}
                        aria-label={`Открыть ${p.name}`}
                      >
                        Открыть →
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          <Pager total={products.total} page={products.page} href={href} />
        </>
      )}
      <p className="mirror-page-note">
        Страница обновляется раз в минуту. Время Душанбе (UTC+5). <Help topic="sync" />
      </p>
    </>
  );
}

import Link from 'next/link';
import { requireAdminSession } from '@/lib/admin-auth';
import { getMirrorStatus, searchMirrorProducts } from '@/lib/api-v1/pharmacy-mirror-server';
import { mirrorTime, mirrorQuantity, mirrorSearchError } from '@/lib/pharmacy-mirror';
import Refresh from './Refresh';
import { Pager, ReadOnly, Prices, Valuation } from './parts';

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
          <ReadOnly />
        </div>
        <Refresh />
      </header>
      <p>
        Копия «Алгоритма». Проверка каждые 60 секунд, пока вкладка открыта. Время Душанбе (UTC+5).
      </p>
      {status ? (
        <section className="mirror-panel" aria-label="Состояние зеркала">
          <div className="mirror-stats">
            <div>
              Последняя связь<strong>{mirrorTime(status.last_seen_at)}</strong>
            </div>
            <div>
              Последний пакет<strong>{mirrorTime(status.last_batch_at)}</strong>
            </div>
            {[
              ['Товары', 'T_PRODUCT'],
              ['Строки остатков', 'T_SKLAD_STATE'],
              ['Партии / приходы', 'T_INCOME'],
            ].map(([label, table]) => (
              <div key={table}>
                {label}
                <strong>
                  {status.tables
                    .find((t) => t.table_name === table)
                    ?.row_count.toLocaleString('ru-RU') ?? '—'}
                </strong>
              </div>
            ))}
          </div>
          {status.freshness === 'stale' && (
            <p role="alert" className="mirror-warning">
              Нет связи с агентом более 3 минут. Остатки могут быть устаревшими.
            </p>
          )}
          {status.last_batch && (
            <p className="mirror-meta">
              Пакет {status.last_batch.batch_id} · {status.last_batch.table_name} · Получено{' '}
              {mirrorTime(status.last_batch.received_at)} · Строк {status.last_batch.upserted_count}
            </p>
          )}
          <details>
            <summary>Все 12 таблиц и свежесть</summary>
            <p>
              «Давно не обновлялось» означает отсутствие изменённых строк более 3 минут. Справочники
              могут не меняться долго даже при работающем агенте. Для связи смотрите время выше.
            </p>
            <div className="mirror-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Таблица</th>
                    <th>Строк</th>
                    <th>max_change_id</th>
                    <th>last_received_at</th>
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
                      <td>{t.freshness === 'current' ? 'Актуально' : 'Давно не обновлялось'}</td>
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
            placeholder="Название, PRODUCT_ID или штрихкод"
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label>
          Искать по
          <select name="mode" defaultValue={mode}>
            <option value="auto">Авто: ID / штрихкод / название</option>
            <option value="name">Название</option>
            <option value="id">PRODUCT_ID</option>
            <option value="barcode">Штрихкод товара / партии</option>
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
        <p>
          Введите минимум 2 символа названия, ID или штрихкод. Поиск по ID и штрихкоду — точный.
        </p>
      )}
      {products && (
        <>
          <Pager total={products.total} page={products.page} href={href} />
          {products.items.length === 0 ? (
            <p role="status">Товары не найдены. Проверьте запрос или тип поиска.</p>
          ) : (
            <>
              <div className="mirror-desktop mirror-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PRODUCT_ID</th>
                      <th>Название</th>
                      <th>Штрихкод</th>
                      <th>Остаток</th>
                      <th>Цены за единицу, с НДС</th>
                      <th>Сумма текущего остатка</th>
                      <th>Карточка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.items.map((p) => (
                      <tr key={p.product_id}>
                        <td>{p.product_id}</td>
                        <th scope="row">
                          {p.name}
                          <small className="mirror-result-vendor">
                            {p.vendor || 'Производитель не указан'}
                          </small>
                        </th>
                        <td>{p.barcode || '—'}</td>
                        <td>
                          {mirrorQuantity(p.total_stock, p.stock_rows, p.invalid_stock_rows)}
                          <small>{mirrorTime(p.stock_received_at)}</small>
                        </td>
                        <td>
                          <Prices prices={p} />
                        </td>
                        <td>
                          <Valuation prices={p} />
                        </td>
                        <td>
                          <Link
                            href={`/admin/pharmacy-mirror/products/${p.product_id}`}
                            aria-label={`Открыть ${p.name}`}
                          >
                            Открыть
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mirror-mobile">
                {products.items.map((p) => (
                  <article className="mirror-panel" key={p.product_id}>
                    <h2>{p.name}</h2>
                    <p>
                      PRODUCT_ID: {p.product_id} · {p.barcode || 'Штрихкод не указан'}
                    </p>
                    <p>{p.vendor || 'Производитель не указан'}</p>
                    <strong>
                      Остаток: {mirrorQuantity(p.total_stock, p.stock_rows, p.invalid_stock_rows)}
                    </strong>
                    <Prices prices={p} />
                    <p className="mirror-meta">Сумма текущего остатка</p>
                    <Valuation prices={p} />
                    <p>Остатки: {mirrorTime(p.stock_received_at)}</p>
                    <Link
                      href={`/admin/pharmacy-mirror/products/${p.product_id}`}
                      aria-label={`Открыть ${p.name}`}
                    >
                      Открыть →
                    </Link>
                  </article>
                ))}
              </div>
            </>
          )}
          <Pager total={products.total} page={products.page} href={href} />
          <p className="mirror-meta">
            PRODUCT_ID — ID товара в «Алгоритме». Продажа: OUTCOME_PRICE_ONE_W_NDS; приход:
            INCOME_PRICE_W_NDS, с НДС. Диапазон — разные цены партий с положительным остатком; при
            его отсутствии показаны исторические цены. Сумма остатка = количество каждой партии × её
            цена. Это стоимость оставшегося товара, а не выручка и не сумма всех приходов. Нет
            данных — нужные строки или цены отсутствуют в зеркале.
          </p>
        </>
      )}
    </>
  );
}

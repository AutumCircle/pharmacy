import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin-auth';
import { getMirrorProduct } from '@/lib/api-v1/pharmacy-mirror-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import { mirrorTime, mirrorQuantity } from '@/lib/pharmacy-mirror';
import Refresh from '../../Refresh';
import { Pager, Raw, ReadOnly } from '../../parts';

export const dynamic = 'force-dynamic';
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ product_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const { product_id: id } = await params;
  const query = await searchParams;
  const page = (v: unknown) =>
    typeof v === 'string' && /^[1-9][0-9]{0,3}$/.test(v) ? Number(v) : 1;
  const stockPage = page(query.stock_page),
    incomePage = page(query.income_page);
  const data = await getMirrorProduct(id, stockPage, incomePage).catch((error) => {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  });
  const { product, stock, dictionaries } = data;
  const value = (k: string) => String(product.oracle[k] ?? '—');
  const href = (s: number, i: number) =>
    `/admin/pharmacy-mirror/products/${id}?stock_page=${s}&income_page=${i}`;
  return (
    <>
      <Link href="/admin/pharmacy-mirror">← К поиску</Link>
      <header className="mirror-header">
        <div>
          <h1>{value('PRODUCT_NAME')}</h1>
          <ReadOnly />
        </div>
        <Refresh />
      </header>
      <p>Обновление каждые 60 секунд. Время Душанбе (UTC+5).</p>
      <section className="mirror-panel">
        <h2>Основная информация</h2>
        <dl className="mirror-facts">
          <div>
            <dt>PRODUCT_ID</dt>
            <dd>{id}</dd>
          </div>
          <div>
            <dt>Штрихкод · SCAN_CODE</dt>
            <dd>{value('SCAN_CODE')}</dd>
          </div>
          {(
            [
              ['vendor', 'Производитель'],
              ['country', 'Страна'],
              ['mnn', 'МНН'],
              ['group', 'Группа'],
              ['measure', 'Единица'],
              ['type', 'Тип'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <dt>{label}</dt>
              <dd>
                {dictionaries[k].name ??
                  (dictionaries[k].id
                    ? `ID ${dictionaries[k].id} · справочник не найден`
                    : 'Не указано в источнике')}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Товар скопирован: {mirrorTime(product.source_generated_at)} · Получен:{' '}
          {mirrorTime(product.received_at)} · CHANGE_ID {product.change_id ?? '—'}
        </p>
        <Raw row={product} />
      </section>
      <section className="mirror-panel">
        <h2>Остатки по складам и партиям</h2>
        <p className="mirror-total">
          Общий остаток:{' '}
          <strong>
            {mirrorQuantity(stock.total_stock, stock.stock_rows, stock.invalid_stock_rows)}
          </strong>
        </p>
        <p>
          Сумма PRODUCT_COUNT_SKLAD по всем складам. Резерв не вычитается. Единицы и дробные
          значения скопированы без пересчёта.
        </p>
        <p>
          Остатки скопированы: {mirrorTime(stock.stock_generated_at)} · Получены:{' '}
          {mirrorTime(stock.stock_received_at)} · max_change_id:{' '}
          <strong>{stock.stock_max_change_id ?? '—'}</strong>
        </p>
        {stock.stock_received_at &&
          Date.parse(data.checked_at) - Date.parse(stock.stock_received_at) > 180_000 && (
            <p className="mirror-warning">
              Строки остатков давно не менялись. Это само по себе не означает потерю связи. После
              продажи проверьте количество и время получения.
            </p>
          )}
        {data.stocks.items.length === 0 && (
          <p>Строк остатков на этой странице нет. Отсутствие строки не означает нулевой остаток.</p>
        )}
        <div className="mirror-records">
          {data.stocks.items.map((r) => (
            <article key={r.row_key}>
              <details>
                <summary>
                  <span>
                    {r.warehouse_name || `Склад ${r.oracle.SKLAD_ID ?? '—'}`} · Партия{' '}
                    {String(r.oracle.INCOME_ID ?? '—')}
                  </span>
                  <small>
                    Остаток: <strong>{String(r.oracle.PRODUCT_COUNT_SKLAD ?? 'нет данных')}</strong>{' '}
                    · Резерв: {String(r.oracle.PRODUCT_COUNT_REZERV ?? '—')}
                  </small>
                </summary>
                <p>
                  SKLAD_STATE_ID: {r.row_key} · CHANGE_ID: {r.change_id ?? '—'}
                </p>
                <p>Получено: {mirrorTime(r.received_at)}</p>
                {r.income_date_old && <p>INCOME_DATE_OLD: {r.income_date_old.slice(0, 10)}</p>}
                <Raw row={r} />
              </details>
            </article>
          ))}
        </div>
        <Pager total={data.stocks.total} page={stockPage} href={(p) => href(p, incomePage)} />
      </section>
      <section className="mirror-panel">
        <h2>Связанные приходы / партии</h2>
        <p>
          Связь по PRODUCT_ID; остатки связаны с приходами по INCOME_ID. Поле INCOME_DATE_OLD
          показано как в источнике — назначение даты нужно сверить с «Алгоритмом». Ценовые уровни не
          пересчитываются.
        </p>
        {data.incomes.items.length === 0 && <p>Приходов на этой странице нет.</p>}
        <div className="mirror-records">
          {data.incomes.items.map((r) => (
            <article key={r.row_key}>
              <details>
                <summary>
                  <span>INCOME_ID {r.row_key}</span>
                  <small>
                    INCOME_COUNT: {String(r.oracle.INCOME_COUNT ?? '—')} · INCOME_DATE_OLD:{' '}
                    {String(r.oracle.INCOME_DATE_OLD ?? '—').slice(0, 10)}
                  </small>
                </summary>
                <p>Штрихкод партии: {String(r.oracle.INCOME_SCAN_CODE ?? '—')}</p>
                <p>Количество INCOME_COUNT: {String(r.oracle.INCOME_COUNT ?? '—')}</p>
                <p>
                  INCOME_DATE_OLD: {String(r.oracle.INCOME_DATE_OLD ?? '—')} · Серия:{' '}
                  {String(r.oracle.INCOME_SERIA ?? '—')}
                </p>
                <p>
                  INCOME_PRICE_W_NDS: {String(r.oracle.INCOME_PRICE_W_NDS ?? '—')} ·
                  INCOME_REAL_PRICE: {String(r.oracle.INCOME_REAL_PRICE ?? '—')}
                </p>
                <Raw row={r} />
              </details>
            </article>
          ))}
        </div>
        <Pager total={data.incomes.total} page={incomePage} href={(p) => href(stockPage, p)} />
      </section>
      <section className="mirror-panel">
        <h2>Сравнение с действующим сайтом</h2>
        <p>{data.site_comparison.reason}</p>
      </section>
    </>
  );
}

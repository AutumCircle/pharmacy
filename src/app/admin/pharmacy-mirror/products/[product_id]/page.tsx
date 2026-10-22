import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin-auth';
import { getMirrorProduct } from '@/lib/api-v1/pharmacy-mirror-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import { mirrorTime, mirrorQuantity, mirrorMoney } from '@/lib/pharmacy-mirror';
import Refresh from '../../Refresh';
import { Pager, Raw, ReadOnly, Prices, Valuation, OracleFields } from '../../parts';

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
          <p className="mirror-product-id">
            ID товара в «Алгоритме»: <strong>{id}</strong> <code>PRODUCT_ID</code>
          </p>
          <ReadOnly />
        </div>
        <Refresh />
      </header>
      <p>Обновление каждые 60 секунд. Время Душанбе (UTC+5).</p>
      <section className="mirror-panel" aria-label="Цены и текущий остаток">
        <h2>Цены и текущий остаток</h2>
        <div className="mirror-summary-grid">
          <div>
            <span>Количество в наличии</span>
            <strong>
              {mirrorQuantity(stock.total_stock, stock.stock_rows, stock.invalid_stock_rows)}
            </strong>
          </div>
          <div>
            <span>Цены за единицу, с НДС</span>
            <Prices prices={stock} />
          </div>
          <div>
            <span>Стоимость текущего остатка</span>
            <Valuation prices={stock} />
          </div>
        </div>
        <p className="mirror-meta">
          Продажа — OUTCOME_PRICE_ONE_W_NDS (уровень 1), приход — INCOME_PRICE_W_NDS. Диапазон
          учитывает партии с положительным остатком; если их нет, показаны исторические цены.
          Стоимость остатка — сумма «остаток партии × её цена», без вычитания резерва. Это не
          выручка и не общая сумма документов прихода. Если цена отсутствует у ненулевой партии,
          итоговая стоимость не рассчитывается.
        </p>
      </section>
      <section className="mirror-panel">
        <h2>Основная информация</h2>
        <dl className="mirror-facts">
          <div>
            <dt>ID товара · PRODUCT_ID</dt>
            <dd>{id}</dd>
          </div>
          <div>
            <dt>Штрихкод товара · SCAN_CODE</dt>
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
          ).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {dictionaries[key].name ??
                  (dictionaries[key].id != null
                    ? `ID ${dictionaries[key].id} · справочник не найден`
                    : 'Не указано в источнике')}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mirror-meta">
          Скопировано: {mirrorTime(product.source_generated_at)} · Получено:{' '}
          {mirrorTime(product.received_at)} · Номер изменения: {product.change_id ?? '—'}
        </p>
        <h3>Все поля товара</h3>
        <OracleFields row={product} />
        <Raw row={product} />
      </section>
      <section className="mirror-panel">
        <h2>Остатки по складам и партиям</h2>
        <p>
          Записей: {stock.stock_rows}. Получены: {mirrorTime(stock.stock_received_at)} · Последнее
          изменение: <strong>{stock.stock_max_change_id ?? '—'}</strong>
        </p>
        <p className="mirror-meta">
          Партия — INCOME_ID, строка остатка — SKLAD_STATE_ID. Они отличаются от ID товара
          PRODUCT_ID. Раскройте строку, чтобы увидеть все значения.
        </p>
        {stock.stock_received_at &&
          Date.parse(data.checked_at) - Date.parse(stock.stock_received_at) > 180_000 && (
            <p className="mirror-warning">
              Остатки давно не менялись. После продажи проверьте количество и время получения;
              отсутствие изменений само по себе не означает потерю связи.
            </p>
          )}
        {data.stocks.items.length === 0 && (
          <p>
            Нет данных об остатке на этой странице зеркала. Это не подтверждённый нулевой остаток.
          </p>
        )}
        <div className="mirror-records">
          {data.stocks.items.map((row) => (
            <article key={row.row_key}>
              <details>
                <summary>
                  <span>
                    {row.warehouse_name || `Склад ${row.oracle.SKLAD_ID ?? '—'}`} · Партия{' '}
                    {String(row.oracle.INCOME_ID ?? '—')}
                  </span>
                  <small>
                    Остаток:{' '}
                    <strong>{String(row.oracle.PRODUCT_COUNT_SKLAD ?? 'нет данных')}</strong> ·
                    Резерв: {String(row.oracle.PRODUCT_COUNT_REZERV ?? '—')}
                  </small>
                  <small>
                    Продажа:{' '}
                    {mirrorMoney(row.oracle.OUTCOME_PRICE_ONE_W_NDS as string | number | null)} ·
                    Приход: {mirrorMoney(row.purchase_price)}
                  </small>
                </summary>
                <dl className="mirror-facts">
                  <div>
                    <dt>ID строки остатка · SKLAD_STATE_ID</dt>
                    <dd>{row.row_key}</dd>
                  </div>
                  <div>
                    <dt>Штрихкод партии</dt>
                    <dd>{row.income_barcode || 'Нет данных'}</dd>
                  </div>
                  <div>
                    <dt>Цена прихода, с НДС</dt>
                    <dd>{mirrorMoney(row.purchase_price)}</dd>
                  </div>
                  <div>
                    <dt>Получено</dt>
                    <dd>{mirrorTime(row.received_at)}</dd>
                  </div>
                </dl>
                <OracleFields row={row} />
                <Raw row={row} />
              </details>
            </article>
          ))}
        </div>
        <Pager total={data.stocks.total} page={stockPage} href={(p) => href(p, incomePage)} />
      </section>
      <section className="mirror-panel">
        <h2>Связанные приходы / партии</h2>
        <p>
          Здесь показаны цены, количества и суммы каждого прихода. INCOME_ID — ID прихода,
          INCOME_HEAD_ID — ID его документа. Дата INCOME_DATE_OLD сохранена под исходным названием.
        </p>
        {data.incomes.items.length === 0 && <p>Нет приходов на этой странице.</p>}
        <div className="mirror-records">
          {data.incomes.items.map((row) => (
            <article key={row.row_key}>
              <details>
                <summary>
                  <span>Приход / партия № {row.row_key}</span>
                  <small>
                    Количество: {String(row.oracle.INCOME_COUNT ?? '—')} · Цена:{' '}
                    {mirrorMoney(row.oracle.INCOME_PRICE_W_NDS as string | number | null)}
                  </small>
                  <small>
                    Сумма прихода:{' '}
                    {mirrorMoney(row.oracle.INCOME_SUM_W_NDS as string | number | null)} · Дата
                    INCOME_DATE_OLD: {String(row.oracle.INCOME_DATE_OLD ?? '—').slice(0, 10)}
                  </small>
                </summary>
                <h3>Все поля прихода</h3>
                <OracleFields row={row} />
                <Raw row={row} />
              </details>
            </article>
          ))}
        </div>
        <Pager total={data.incomes.total} page={incomePage} href={(p) => href(stockPage, p)} />
      </section>
      <p className="mirror-meta">
        Показаны все разрешённые поля, которые получены в зеркале. Пустые Oracle-поля агент не
        передаёт. Служебные данные сотрудников и контрагентов скрыты.
      </p>
      <section className="mirror-panel">
        <h2>Сравнение с действующим сайтом</h2>
        <p>{data.site_comparison.reason}</p>
      </section>
    </>
  );
}

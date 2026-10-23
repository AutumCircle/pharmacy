import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminSession } from '@/lib/admin-auth';
import { getMirrorProduct } from '@/lib/api-v1/pharmacy-mirror-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import { mirrorTime, mirrorQuantity, mirrorMoney } from '@/lib/pharmacy-mirror';
import Refresh from '../../Refresh';
import Help from '../../Help';
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
  const stockView = query.stock_view === 'all' ? 'all' : 'nonzero';
  const data = await getMirrorProduct(id, stockPage, incomePage, stockView).catch((error) => {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  });
  const { product, stock, dictionaries } = data;
  const value = (k: string) => String(product.oracle[k] ?? 'Не указано');
  const href = (s: number, i: number, view = stockView) =>
    `/admin/pharmacy-mirror/products/${id}?stock_page=${s}&income_page=${i}&stock_view=${view}`;
  return (
    <>
      <Link className="mirror-back" href="/admin/pharmacy-mirror">
        ← К поиску товаров
      </Link>
      <header className="mirror-header">
        <div>
          <h1>{value('PRODUCT_NAME')}</h1>
          <p className="mirror-product-id">
            Номер товара: <strong>{id}</strong> <Help topic="productId" />
          </p>
          <div className="mirror-inline">
            <ReadOnly />
            <Help topic="shadow" />
          </div>
        </div>
        <Refresh />
      </header>
      <section className="mirror-panel mirror-overview" aria-label="Цены и текущий остаток">
        <h2>Главное о товаре</h2>
        <div className="mirror-summary-grid">
          <div className="mirror-quantity-tile">
            <span>
              Общий остаток <Help topic="stock" />
            </span>
            <strong>
              {stock.stock_rows === 0
                ? 'Нет данных'
                : mirrorQuantity(stock.total_stock, stock.stock_rows, stock.invalid_stock_rows)}
            </strong>
            <small>Единица учёта: {dictionaries.measure.name || 'не указана'}</small>
          </div>
          <Prices prices={stock} />
        </div>
        <p className="mirror-last-update">
          Изменение остатков получено: {mirrorTime(stock.stock_received_at)}{' '}
          <Help topic="received" />
        </p>
      </section>
      <section className="mirror-panel">
        <h2>О товаре</h2>
        <dl className="mirror-facts">
          <div>
            <dt>Штрихкод</dt>
            <dd>{value('SCAN_CODE')}</dd>
          </div>
          {(
            [
              ['vendor', 'Производитель'],
              ['country', 'Страна'],
              ['mnn', 'МНН'],
              ['group', 'Группа'],
              ['type', 'Тип'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{dictionaries[key].name || 'Не указано'}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="mirror-panel" id="stock-breakdown">
        <div className="mirror-section-heading">
          <h2>Из чего складывается остаток</h2>
          <Help topic="receipt" />
        </div>
        <div className="mirror-stock-controls">
          <nav className="mirror-view-switch" aria-label="Какие поступления показывать">
            <Link
              href={href(1, incomePage, 'nonzero') + '#stock-breakdown'}
              aria-current={stockView === 'nonzero' ? 'page' : undefined}
            >
              С остатком
            </Link>
            <Link
              href={href(1, incomePage, 'all') + '#stock-breakdown'}
              aria-current={stockView === 'all' ? 'page' : undefined}
            >
              Все поступления
            </Link>
          </nav>
          <Help topic="history" />
        </div>
        <p className="mirror-meta">Найдено записей: {data.stocks.total.toLocaleString('ru-RU')}</p>
        {data.stocks.items.length === 0 && (
          <p className="mirror-empty">
            {stock.stock_rows === 0
              ? 'В зеркале пока нет данных об остатке этого товара.'
              : stockView === 'nonzero' && stock.current_stock_rows === 0
                ? 'Все найденные записи имеют нулевой остаток. Они доступны в списке «Все поступления».'
                : 'На этой странице записей нет.'}
          </p>
        )}
        <div className="mirror-records">
          {data.stocks.items.map((row) => (
            <article className="mirror-stock-record" key={row.row_key}>
              <details>
                <summary>
                  <span className="mirror-record-quantity">
                    Осталось: {String(row.oracle.PRODUCT_COUNT_SKLAD ?? 'нет данных')}
                  </span>
                  <small>
                    {row.warehouse_name || `Склад ${row.oracle.SKLAD_ID ?? 'не указан'}`}
                  </small>
                  <small className="mirror-record-prices">
                    Продажа:{' '}
                    <strong>
                      {mirrorMoney(row.oracle.OUTCOME_PRICE_ONE_W_NDS as string | number | null)}
                    </strong>{' '}
                    · Приход: <strong>{mirrorMoney(row.purchase_price)}</strong>
                  </small>
                  <span className="mirror-record-more">Подробнее о поступлении</span>
                </summary>
                <dl className="mirror-facts">
                  <div>
                    <dt>
                      Номер поступления <Help topic="receiptId" />
                    </dt>
                    <dd>{String(row.oracle.INCOME_ID ?? 'Нет данных')}</dd>
                  </div>
                  <div>
                    <dt>
                      Склад <Help topic="warehouse" />
                    </dt>
                    <dd>{row.warehouse_name || String(row.oracle.SKLAD_ID ?? 'Нет данных')}</dd>
                  </div>
                  <div>
                    <dt>
                      В резерве <Help topic="reserve" />
                    </dt>
                    <dd>{String(row.oracle.PRODUCT_COUNT_REZERV ?? 'Нет данных')}</dd>
                  </div>
                  <div>
                    <dt>Штрихкод поступления</dt>
                    <dd>{row.income_barcode || 'Не указан'}</dd>
                  </div>
                  <div>
                    <dt>
                      Получено в AWS <Help topic="received" />
                    </dt>
                    <dd>{mirrorTime(row.received_at)}</dd>
                  </div>
                </dl>
                <details className="mirror-technical">
                  <summary>Исходные поля этой записи</summary>
                  <OracleFields row={row} />
                  <Raw row={row} />
                </details>
              </details>
            </article>
          ))}
        </div>
        {data.stocks.total > 25 && (
          <Pager
            total={data.stocks.total}
            page={stockPage}
            href={(p) => href(p, incomePage) + '#stock-breakdown'}
          />
        )}
      </section>
      <section className="mirror-panel">
        <div className="mirror-section-heading">
          <h2>Стоимость всего остатка</h2>
          <Help topic="valuation" />
        </div>
        <details className="mirror-valuation">
          <summary>Посмотреть суммы по продаже и приходу</summary>
          <Valuation prices={stock} />
        </details>
      </section>
      <section className="mirror-panel" id="income-history">
        <div className="mirror-section-heading">
          <h2>История поступлений</h2>
          <Help topic="history" />
        </div>
        <details className="mirror-income-history" open={incomePage > 1}>
          <summary>
            Посмотреть историю · записей {data.incomes.total.toLocaleString('ru-RU')}
          </summary>
          {data.incomes.items.length === 0 && (
            <p className="mirror-empty">Записей о поступлениях на этой странице нет.</p>
          )}
          <div className="mirror-records">
            {data.incomes.items.map((row) => (
              <article className="mirror-income-record" key={row.row_key}>
                <details>
                  <summary>
                    <span>Поступило: {String(row.oracle.INCOME_COUNT ?? 'нет данных')}</span>
                    <small>
                      Цена прихода за единицу:{' '}
                      <strong>
                        {mirrorMoney(row.oracle.INCOME_PRICE_W_NDS as string | number | null)}
                      </strong>
                    </small>
                    <span className="mirror-record-more">Подробнее о поступлении</span>
                  </summary>
                  <dl className="mirror-facts">
                    <div>
                      <dt>
                        Номер поступления <Help topic="receiptId" />
                      </dt>
                      <dd>{row.row_key}</dd>
                    </div>
                    <div>
                      <dt>
                        Сумма строки прихода <Help topic="incomeSum" />
                      </dt>
                      <dd>{mirrorMoney(row.oracle.INCOME_SUM_W_NDS as string | number | null)}</dd>
                    </div>
                    <div>
                      <dt>Штрихкод поступления</dt>
                      <dd>{String(row.oracle.INCOME_SCAN_CODE ?? 'Не указан')}</dd>
                    </div>
                    <div>
                      <dt>
                        Дата из «Алгоритма» <Help topic="sourceDate" />
                      </dt>
                      <dd>{String(row.oracle.INCOME_DATE_OLD ?? 'Не указана')}</dd>
                    </div>
                  </dl>
                  <details className="mirror-technical">
                    <summary>Все поля этого прихода</summary>
                    <OracleFields row={row} />
                    <Raw row={row} />
                  </details>
                </details>
              </article>
            ))}
          </div>
          <Pager
            total={data.incomes.total}
            page={incomePage}
            href={(p) => href(stockPage, p) + '#income-history'}
          />
        </details>
      </section>
      <section className="mirror-panel">
        <div className="mirror-section-heading">
          <h2>Данные «Алгоритма»</h2>
          <Help topic="raw" />
        </div>
        <details className="mirror-product-source">
          <summary>Все исходные поля товара</summary>
          <p className="mirror-meta">
            PRODUCT_ID: {id} · CHANGE_ID: {product.change_id ?? 'нет в источнике'} · Скопировано:{' '}
            {mirrorTime(product.source_generated_at)} · Получено: {mirrorTime(product.received_at)}
          </p>
          <OracleFields row={product} />
          <Raw row={product} />
          <p className="mirror-meta">{data.site_comparison.reason}</p>
        </details>
      </section>
      <p className="mirror-page-note">
        Страница обновляется раз в минуту. Время Душанбе (UTC+5). <Help topic="sync" />
      </p>
    </>
  );
}

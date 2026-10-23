import Link from 'next/link';
import {
  mirrorTime,
  mirrorMoney,
  mirrorPriceRange,
  type OracleRow,
  type MirrorPrices,
} from '@/lib/pharmacy-mirror';
import { oracleFieldLabel, oracleFieldValue } from '@/lib/pharmacy-mirror-fields';
import Help from './Help';
import { oracleFieldHelpTopic } from '@/lib/pharmacy-mirror-help';
export function Pager({
  total,
  page,
  href,
}: {
  total: number;
  page: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <nav className="mirror-pager" aria-label="Страницы результатов">
      {page > 1 && <Link href={href(page - 1)}>← Назад</Link>}
      <span>
        Страница {page} из {pages} · Всего {total.toLocaleString('ru-RU')}
      </span>
      {page < pages && page < 9999 && <Link href={href(page + 1)}>Далее →</Link>}
    </nav>
  );
}
export function Raw({ row, title = 'Исходные поля Oracle' }: { row: OracleRow; title?: string }) {
  return (
    <details>
      <summary>
        {title} · {row.row_key}
      </summary>
      <p>
        Скопировано: {mirrorTime(row.source_generated_at)} · Получено: {mirrorTime(row.received_at)}{' '}
        · CHANGE_ID: {row.change_id ?? 'нет в источнике'}
      </p>
      <pre>{JSON.stringify(row.oracle, null, 2)}</pre>
      <small>
        Показаны разрешённые товарные поля. Служебные поля сотрудников и контрагентов скрыты.
      </small>
    </details>
  );
}
export function ReadOnly() {
  return <p className="mirror-badge">Только просмотр · тестовая база</p>;
}

export function Prices({ prices }: { prices: MirrorPrices }) {
  return (
    <div className="mirror-prices">
      <div>
        <span>
          Цена продажи <Help topic="sale" />
        </span>
        <strong>{mirrorPriceRange(prices.sale_price_min, prices.sale_price_max)}</strong>
      </div>
      <div>
        <span>
          Цена прихода <Help topic="purchase" />
        </span>
        <strong>{mirrorPriceRange(prices.purchase_price_min, prices.purchase_price_max)}</strong>
      </div>
      {prices.price_basis === 'historical' && (
        <small>
          Цены прошлых поступлений <Help topic="historicalPrice" />
        </small>
      )}
    </div>
  );
}

export function Valuation({ prices }: { prices: MirrorPrices }) {
  return (
    <div className="mirror-prices">
      <div>
        <span>По ценам продажи</span>
        <strong>{mirrorMoney(prices.sale_value)}</strong>
      </div>
      <div>
        <span>По ценам прихода</span>
        <strong>{mirrorMoney(prices.purchase_value)}</strong>
      </div>
    </div>
  );
}

export function OracleFields({ row }: { row: OracleRow }) {
  return (
    <dl className="mirror-oracle-fields">
      {Object.entries(row.oracle)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => (
          <div key={key}>
            <dt>
              {oracleFieldLabel(key)}
              <Help topic={oracleFieldHelpTopic(key)} />
              <code>{key}</code>
            </dt>
            <dd>{oracleFieldValue(value)}</dd>
          </div>
        ))}
    </dl>
  );
}

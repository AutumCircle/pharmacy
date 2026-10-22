import Link from 'next/link';
import { mirrorTime, type OracleRow } from '@/lib/pharmacy-mirror';
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

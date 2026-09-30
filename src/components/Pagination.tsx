import Link from 'next/link';

import { getPaginationItems, type PaginationItem } from '@/lib/pagination';

function PageItems({ items, page, pageHref, className }: {
  items: PaginationItem[];
  page: number;
  pageHref: (page: number) => string;
  className: string;
}) {
  return (
    <div className={`category-pagination-pages ${className}`}>
      {items.map((item) => typeof item === 'number' ? (
        item === page ? (
          <span key={item} className="pagination-page-number" aria-current="page" aria-label={`Страница ${item}`}>{item}</span>
        ) : (
          <Link key={item} className="pagination-number-link" href={pageHref(item)} aria-label={`Страница ${item}`}>{item}</Link>
        )
      ) : <span key={item} className="pagination-ellipsis" aria-hidden="true">…</span>)}
    </div>
  );
}

export default function Pagination({ page, totalPages, pageHref, label }: {
  page: number;
  totalPages: number;
  pageHref: (page: number) => string;
  label: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination category-pagination" aria-label={label}>
      <Link className={page <= 1 ? 'disabled' : ''} aria-disabled={page <= 1} aria-label="Предыдущая страница" href={pageHref(Math.max(1, page - 1))}>
        ←<span className="pagination-arrow-text"> Назад</span>
      </Link>
      <PageItems items={getPaginationItems(page, totalPages)} page={page} pageHref={pageHref} className="pagination-full" />
      <PageItems items={getPaginationItems(page, totalPages, true)} page={page} pageHref={pageHref} className="pagination-compact" />
      <Link className={page >= totalPages ? 'disabled' : ''} aria-disabled={page >= totalPages} aria-label="Следующая страница" href={pageHref(Math.min(totalPages, page + 1))}>
        <span className="pagination-arrow-text">Далее </span>→
      </Link>
    </nav>
  );
}

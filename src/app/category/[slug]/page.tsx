import Link from 'next/link';

import ProductCard from '@/components/ProductCard';
import { getPublicCategoryMedicines } from '@/lib/api-v1/server';
import { getPaginationItems } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const parsedPage = Number(rawPage);
  const requestedPage = Number.isInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const response = await getPublicCategoryMedicines(slug, requestedPage, 24);
  const page = response.page.number;
  const pageHref = (number: number) => number === 1
    ? `/category/${encodeURIComponent(slug)}`
    : `/category/${encodeURIComponent(slug)}?page=${number}`;
  const paginationItems = getPaginationItems(page, response.page.total_pages);

  return (
    <div className="container" style={{ paddingTop: '20px', paddingBottom: '50px' }}>
      <div className="category-page-heading">
        <h1 className="section-title">{response.data.name}</h1>
        <p>Товаров: {response.page.total_items.toLocaleString('ru-RU')}</p>
      </div>
      {response.data.medicines.length > 0 ? (
        <div className="medicine-grid">
          {response.data.medicines.map((medicine) => (
            <ProductCard key={medicine.medicine_id} item={medicine} />
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '60px', textAlign: 'center' }}>
          В этой категории пока нет доступных товаров
        </div>
      )}
      {response.page.total_pages > 1 && (
        <nav className="pagination category-pagination" aria-label="Страницы категории">
          <Link className={page <= 1 ? 'disabled' : ''} aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))}>← Назад</Link>
          <div className="category-pagination-pages">
            {paginationItems.map((item) => typeof item === 'number' ? (
              item === page ? (
                <span key={item} className="pagination-page-number" aria-current="page" aria-label={`Страница ${item}`}>{item}</span>
              ) : (
                <Link key={item} className="pagination-number-link" href={pageHref(item)} aria-label={`Страница ${item}`}>{item}</Link>
              )
            ) : <span key={item} className="pagination-ellipsis" aria-hidden="true">…</span>)}
          </div>
          <Link className={page >= response.page.total_pages ? 'disabled' : ''} aria-disabled={page >= response.page.total_pages} href={pageHref(Math.min(response.page.total_pages, page + 1))}>Далее →</Link>
        </nav>
      )}
    </div>
  );
}

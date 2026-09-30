import Link from 'next/link';
import CategoryIcon from '@/components/CategoryIcon';
import { Suspense } from 'react';

import HeroBanners from '@/components/HeroBanners';
import ProductCarousel from '@/components/ProductCarousel';
import ProductCard from '@/components/ProductCard';
import StoreBenefits from '@/components/StoreBenefits';
import { getPublicCategories, getPublicFeaturedProducts, getPublicHomepageBanners, getPublicProductCarousels, searchPublicMedicines } from '@/lib/api-v1/server';
import { getPaginationItems } from '@/lib/pagination';
import type { HomepageBanner, ProductCarousel as ProductCarouselData } from '@/lib/api-v1/types';

const SEARCH_PAGE_SIZE = 24; // divisible by 2, 3, 4 and 6 grid columns, so full pages never end with a half row

async function SearchResults({ q, page }: { q: string; page: number }) {
  const response = await searchPublicMedicines(q, SEARCH_PAGE_SIZE, undefined, page).catch(() => null);
  if (!response) {
    return (
      <section className="products-section" style={{ paddingTop: '30px' }}>
        <h1 className="section-title">Результаты поиска</h1>
        <div className="empty-state" role="alert" style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ marginBottom: '16px' }}>Сервер временно отвечает медленнее обычного.</p>
          <Link href={`/?q=${encodeURIComponent(q)}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
            Повторить поиск
          </Link>
        </div>
      </section>
    );
  }
  const currentPage = response.page.number ?? page;
  // Older API versions return only has_more; then the last known page is the next one.
  const totalPages = response.page.total_pages ?? (response.page.has_more ? currentPage + 1 : currentPage);
  const totalItems = response.page.total_items;
  const pageHref = (number: number) => number === 1
    ? `/?q=${encodeURIComponent(q)}`
    : `/?q=${encodeURIComponent(q)}&page=${number}`;
  return (
    <section className="products-section" style={{ paddingTop: '30px' }}>
      <h1 className="section-title">Результаты поиска: «{q}»</h1>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        {totalItems !== undefined
          ? `Найдено: ${totalItems.toLocaleString('ru-RU')}${totalPages > 1 ? ` · страница ${currentPage} из ${totalPages}` : ''}`
          : `Найдено на этой странице: ${response.data.length}`}
      </p>
      {response.data.length > 0 ? (
        <div className="medicine-grid">
          {response.data.map((medicine) => <ProductCard key={medicine.medicine_id} item={medicine} />)}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '60px', textAlign: 'center' }}>Ничего не найдено</div>
      )}
      {totalPages > 1 && (
        <nav className="pagination category-pagination" aria-label="Страницы результатов поиска">
          <Link className={currentPage <= 1 ? 'disabled' : ''} aria-disabled={currentPage <= 1} href={pageHref(Math.max(1, currentPage - 1))}>← Назад</Link>
          <div className="category-pagination-pages">
            {getPaginationItems(currentPage, totalPages).map((item) => typeof item === 'number' ? (
              item === currentPage ? (
                <span key={item} className="pagination-page-number" aria-current="page" aria-label={`Страница ${item}`}>{item}</span>
              ) : (
                <Link key={item} className="pagination-number-link" href={pageHref(item)} aria-label={`Страница ${item}`}>{item}</Link>
              )
            ) : <span key={item} className="pagination-ellipsis" aria-hidden="true">…</span>)}
          </div>
          <Link className={currentPage >= totalPages ? 'disabled' : ''} aria-disabled={currentPage >= totalPages} href={pageHref(Math.min(totalPages, currentPage + 1))}>Далее →</Link>
        </nav>
      )}
    </section>
  );
}

function SearchLoading() {
  return (
    <section className="products-section" style={{ paddingTop: '30px' }} aria-live="polite">
      <h1 className="section-title">Результаты поиска</h1>
      <div className="empty-state" style={{ padding: '40px', textAlign: 'center' }}>Ищем лекарства…</div>
    </section>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 1 ? Math.min(requestedPage, 5000) : 1;

  if (q.length >= 2) {
    return (
      <div className="container">
        <Suspense key={`${q}:${page}`} fallback={<SearchLoading />}>
          <SearchResults q={q} page={page} />
        </Suspense>
      </div>
    );
  }

  const [categories, bannersResult, carouselsResult] = await Promise.all([
    getPublicCategories(20),
    getPublicHomepageBanners().catch(() => null),
    getPublicProductCarousels().catch(async () => {
      const legacy = await getPublicFeaturedProducts().catch(() => null);
      return legacy ? {
        data: { carousels: [{ slug: 'items-of-the-day', title: 'Товары дня', sort_order: 10, products: legacy.data.products }] },
        request_id: legacy.request_id,
      } : null;
    }),
  ]);
  const banners: HomepageBanner[] | undefined = bannersResult?.data.banners;
  const carousels: ProductCarouselData[] | null = carouselsResult?.data.carousels ?? null;
  return (
    <div className="container">
      <HeroBanners banners={banners} />
      {carousels === null ? (
        <div className="carousel-error" role="status">Секции товаров временно недоступны.</div>
      ) : carousels.map((carousel) => <ProductCarousel key={carousel.slug} carousel={carousel} />)}
      <StoreBenefits />
      <section style={{ paddingBottom: '50px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 className="section-title" style={{ margin: 0 }}>Категории</h2>
          <Link href="/catalog" style={{ color: 'var(--primary)', fontWeight: 500 }}>Смотреть все →</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '20px' }}>
          {categories.data.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="category-card"
              style={{ padding: '25px', background: 'white', borderRadius: '12px', textDecoration: 'none', color: '#333', textAlign: 'center', border: '1px solid #eee' }}
            >
              <div style={{ fontSize: '30px', marginBottom: '10px', color: category.color || 'var(--primary)' }}><CategoryIcon id={category.id} icon={category.icon} size={36} /></div>
              <span style={{ fontWeight: 600 }}>{category.name}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

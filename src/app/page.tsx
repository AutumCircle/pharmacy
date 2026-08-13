import Link from 'next/link';
import { Suspense } from 'react';

import HeroBanners from '@/components/HeroBanners';
import ProductCarousel from '@/components/ProductCarousel';
import ProductCard from '@/components/ProductCard';
import StoreBenefits from '@/components/StoreBenefits';
import { getPublicCategories, getPublicFeaturedProducts, getPublicHomepageBanners, getPublicProductCarousels, searchPublicMedicines } from '@/lib/api-v1/server';
import type { HomepageBanner, ProductCarousel as ProductCarouselData } from '@/lib/api-v1/types';

async function SearchResults({ q, cursor, page }: { q: string; cursor?: string; page: number }) {
  const response = await searchPublicMedicines(q, 20, cursor).catch(() => null);
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
  return (
    <section className="products-section" style={{ paddingTop: '30px' }}>
      <h1 className="section-title">Результаты поиска</h1>
      <p style={{ color: '#666', marginBottom: '20px' }}>Найдено на этой странице: {response.data.length}</p>
      {response.data.length > 0 ? (
        <div className="medicine-grid">
          {response.data.map((medicine) => <ProductCard key={medicine.medicine_id} item={medicine} />)}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '60px', textAlign: 'center' }}>Ничего не найдено</div>
      )}
      {(page > 1 || (response.page.has_more && response.page.next_cursor)) && (
        <nav className="pagination" aria-label="Страницы результатов поиска" style={{ marginTop: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
          {page > 1 ? (
            <Link href={page === 2 || !response.page.previous_cursor
              ? `/?q=${encodeURIComponent(q)}`
              : `/?q=${encodeURIComponent(q)}&cursor=${encodeURIComponent(response.page.previous_cursor)}&page=${page - 1}`}>
              ← Предыдущая
            </Link>
          ) : <span />}
          <span aria-current="page" style={{ color: '#666' }}>Страница {page}</span>
          {response.page.has_more && response.page.next_cursor ? (
            <Link href={`/?q=${encodeURIComponent(q)}&cursor=${encodeURIComponent(response.page.next_cursor)}&page=${page + 1}`}>
              Следующая →
            </Link>
          ) : <span />}
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
  searchParams: Promise<{ q?: string; cursor?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
  const requestedPage = Number(params.page);
  const page = cursor && Number.isInteger(requestedPage) && requestedPage > 1 ? Math.min(requestedPage, 5000) : 1;

  if (q.length >= 2) {
    return (
      <div className="container">
        <Suspense fallback={<SearchLoading />}>
          <SearchResults q={q} cursor={cursor} page={page} />
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
              <div style={{ fontSize: '30px', marginBottom: '10px', color: category.color || 'var(--primary)' }}>{category.icon || '＋'}</div>
              <span style={{ fontWeight: 600 }}>{category.name}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

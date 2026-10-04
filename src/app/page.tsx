import type { Metadata } from 'next';
import Link from 'next/link';
import CategoryIcon from '@/components/CategoryIcon';
import { Suspense } from 'react';

import HeroBanners from '@/components/HeroBanners';
import ProductCarousel from '@/components/ProductCarousel';
import Pagination from '@/components/Pagination';
import ProductCard from '@/components/ProductCard';
import StoreBenefits from '@/components/StoreBenefits';
import { getPublicCategories, getPublicFeaturedProducts, getPublicHomepageBanners, getPublicProductCarousels, searchPublicMedicines } from '@/lib/api-v1/server';
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
          ? `Найдено лекарств: ${totalItems.toLocaleString('ru-RU')}${totalPages > 1 ? ` · страница ${currentPage} из ${totalPages}` : ''}`
          : null}
      </p>
      {response.did_you_mean && (
        <p style={{ marginBottom: '20px' }}>
          {response.data.length > 0 ? 'Показаны результаты для ' : 'Возможно, вы искали: '}
          <Link href={`/?q=${encodeURIComponent(response.did_you_mean)}`} style={{ color: 'var(--primary)', fontWeight: 700 }}>
            «{response.did_you_mean}»
          </Link>
        </p>
      )}
      {response.data.length > 0 ? (
        <div className="medicine-grid">
          {response.data.map((medicine) => <ProductCard key={medicine.medicine_id} item={medicine} />)}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: '60px', textAlign: 'center' }}>Ничего не найдено</div>
      )}
      <Pagination page={currentPage} totalPages={totalPages} pageHref={pageHref} label="Страницы результатов поиска" />
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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  if (q.length >= 2) {
    // Internal search result pages are thin duplicates of product pages; keep
    // them out of the index but let crawlers follow links to products.
    return {
      title: `Поиск: ${q.slice(0, 80)}`,
      robots: { index: false, follow: true },
      alternates: { canonical: '/' },
    };
  }
  return { alternates: { canonical: '/' } };
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
      <section className="seo-about" style={{ paddingBottom: '50px', color: '#444', lineHeight: 1.6 }}>
        <h1 className="section-title" style={{ fontSize: '22px' }}>Аптека Ватан — заказ лекарств с доставкой в Душанбе</h1>
        <p style={{ marginBottom: '12px' }}>
          Аптека «Ватан» в Душанбе: тысячи лекарств, витаминов и товаров для здоровья с актуальными ценами в сомони.
          Найдите нужный препарат через поиск или в <Link href="/catalog" style={{ color: 'var(--primary)' }}>каталоге</Link>,
          добавьте в корзину и оформите заказ — мы доставим его по Душанбе, оплата наличными при получении.
        </p>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '16px 0 8px' }}>Как заказать лекарство в Душанбе</h2>
        <ol style={{ paddingLeft: '20px' }}>
          <li>Введите название лекарства в поиск, например «кальций» или «парацетамол».</li>
          <li>Откройте карточку товара: там указаны цена, производитель и наличие.</li>
          <li>Нажмите «В корзину», затем оформите заказ: имя, телефон и адрес доставки.</li>
          <li>Аптека подтвердит заказ и доставит его. Статус можно проверить на странице <Link href="/tracking" style={{ color: 'var(--primary)' }}>отслеживания заказа</Link>.</li>
        </ol>
      </section>
    </div>
  );
}

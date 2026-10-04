import ProductCard from '@/components/ProductCard';
import { getPublicCategoryMedicines } from '@/lib/api-v1/server';
import Pagination from '@/components/Pagination';
import type { Metadata } from 'next';
import { SITE_CITY, categoryPath } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { page: rawPage } = await searchParams;
  const page = Number(rawPage);
  const response = await getPublicCategoryMedicines(slug, 1, 24).catch(() => null);
  if (!response) return { title: 'Каталог лекарств', robots: { index: false, follow: true } };
  const name = response.data.name;
  const pageSuffix = Number.isInteger(page) && page > 1 ? ` — страница ${page}` : '';
  const title = `${name} — купить в ${SITE_CITY} с доставкой${pageSuffix}`;
  const description = `${name} в аптеке Ватан: ${response.page.total_items.toLocaleString('ru-RU')} товаров с ценами в сомони. `
    + `Закажите онлайн с доставкой по ${SITE_CITY}, оплата при получении.`;
  const path = Number.isInteger(page) && page > 1 ? `${categoryPath(slug)}?page=${page}` : categoryPath(slug);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
  };
}

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
      <Pagination page={page} totalPages={response.page.total_pages} pageHref={pageHref} label="Страницы категории" />
    </div>
  );
}

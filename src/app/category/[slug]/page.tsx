import Link from 'next/link';

import ProductCard from '@/components/ProductCard';
import { getPublicCategoryMedicines } from '@/lib/api-v1/server';

export const dynamic = 'force-dynamic';

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { slug } = await params;
  const { cursor } = await searchParams;
  const response = await getPublicCategoryMedicines(slug, 20, cursor);

  return (
    <div className="container" style={{ paddingTop: '20px', paddingBottom: '50px' }}>
      <h1 className="section-title" style={{ marginBottom: '20px' }}>{response.data.name}</h1>
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
      {response.page.has_more && response.page.next_cursor && (
        <div className="pagination" style={{ marginTop: '40px' }}>
          <Link href={`/category/${slug}?cursor=${encodeURIComponent(response.page.next_cursor)}`}>
            Показать ещё →
          </Link>
        </div>
      )}
    </div>
  );
}

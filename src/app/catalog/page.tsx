import Link from 'next/link';

import { getPublicCategories } from '@/lib/api-v1/server';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const response = await getPublicCategories(100);
  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>
      <h1 className="section-title" style={{ marginBottom: '30px' }}>Каталог товаров</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
        {response.data.map((category) => (
          <Link
            key={category.id}
            href={`/category/${category.slug}`}
            className="category-card"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 20px', background: 'white', borderRadius: '12px', border: '1px solid #eee', textDecoration: 'none', color: '#333', textAlign: 'center' }}
          >
            <div style={{ width: '60px', height: '60px', background: '#f5f5f5', color: category.color || 'var(--primary)', borderRadius: '50%', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px' }}>
              {category.icon || '＋'}
            </div>
            <span style={{ fontWeight: 600 }}>{category.name}</span>
          </Link>
        ))}
        {response.data.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: '#666' }}>
            В каталоге пока нет активных категорий.
          </div>
        )}
      </div>
    </div>
  );
}

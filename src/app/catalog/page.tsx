import Link from 'next/link';
export const revalidate = 0;

export default async function CatalogPage() {
  const categories = [
    { id: 1, name: 'Моковая категория 1', slug: 'mock-category-1' },
    { id: 2, name: 'Моковая категория 2', slug: 'mock-category-2' }
  ];

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>
      <h1 className="section-title" style={{ marginBottom: '30px' }}>Каталог товаров</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}>
        {categories.length > 0 ? (
          categories.map((cat: any) => (
            <Link 
              key={cat.id} 
              href={`/category/${cat.slug}`}
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '30px 20px', 
                background: 'white', 
                borderRadius: '12px', 
                boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                textDecoration: 'none',
                color: '#333',
                textAlign: 'center',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              className="category-card"
            >
              <div style={{ width: '60px', height: '60px', background: '#f5f5f5', borderRadius: '50%', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                </svg>
              </div>
              <span style={{ fontWeight: '500' }}>{cat.name}</span>
            </Link>
          ))
        ) : (
          <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: '#666', background: 'white', borderRadius: '12px' }}>
            В каталоге пока нет категорий.
          </div>
        )}
      </div>
    </div>
  );
}

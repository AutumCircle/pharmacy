'use client';

import { useFavorites } from '../../context/FavoritesContext';
import ProductCard from '../../components/ProductCard';
import Link from 'next/link';

export default function FavoritesPage() {
  const { items } = useFavorites();

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: '80px 0', textAlign: 'center' }}>
        <div style={{ marginBottom: '20px', color: 'var(--border)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
        </div>
        <h2 style={{ marginBottom: '10px' }}>В избранном пока ничего нет</h2>
        <p style={{ color: '#666', marginBottom: '30px' }}>Добавляйте товары в избранное, чтобы купить их позже.</p>
        <Link href="/" className="pagination button" style={{ padding: '10px 20px', background: 'var(--primary)', color: 'white' }}>
          Перейти к товарам
        </Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>
      <h1 className="section-title" style={{ marginBottom: '30px' }}>Избранные товары ({items.length})</h1>
      
      <div className="medicine-grid">
        {items.map((item, index) => (
          <ProductCard key={`${item.name}-${index}`} item={item} />
        ))}
      </div>
    </div>
  );
}

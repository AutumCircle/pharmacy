'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { CategoriesResponse, PublicCategory } from '@/lib/api-v1/types';

export default function CategoryNav() {
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/categories?limit=100', { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as CategoriesResponse;
        setCategories(payload.data);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Category navigation request failed');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  if (categories.length === 0) return null;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rowRef.current) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      rowRef.current.scrollBy({ left: event.key === 'ArrowRight' ? 240 : -240, behavior: 'smooth' });
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      rowRef.current.scrollTo({ left: event.key === 'Home' ? 0 : rowRef.current.scrollWidth, behavior: 'smooth' });
    }
  };
  return (
    <nav className="categories-bar" aria-label="Категории">
      <div ref={rowRef} className="container filter-bar" tabIndex={0} onKeyDown={handleKeyDown} aria-label="Прокручиваемый список категорий">
        {categories.map((category) => (
          <Link key={category.id} href={`/category/${category.slug}`} className="chip">
            {category.icon ? `${category.icon} ` : ''}{category.name}
          </Link>
        ))}
      </div>
    </nav>
  );
}

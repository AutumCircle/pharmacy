'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CategoriesResponse, PublicCategory } from '@/lib/api-v1/types';
import { carouselBoundaryState } from '@/lib/carousel-scroll';

export default function CategoryNav() {
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [boundaries, setBoundaries] = useState({ atStart: true, atEnd: true });
  const rowRef = useRef<HTMLDivElement>(null);

  const updateBoundaries = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setBoundaries(carouselBoundaryState(row.scrollLeft, row.scrollWidth, row.clientWidth));
  }, []);

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

  useEffect(() => {
    const row = rowRef.current;
    if (!row || categories.length === 0) return;
    const frame = requestAnimationFrame(updateBoundaries);
    row.addEventListener('scroll', updateBoundaries, { passive: true });
    window.addEventListener('resize', updateBoundaries, { passive: true });
    const observer = new ResizeObserver(updateBoundaries);
    observer.observe(row);
    return () => {
      cancelAnimationFrame(frame);
      row.removeEventListener('scroll', updateBoundaries);
      window.removeEventListener('resize', updateBoundaries);
      observer.disconnect();
    };
  }, [categories.length, updateBoundaries]);

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
  const move = (direction: -1 | 1) => {
    rowRef.current?.scrollBy({ left: direction * Math.max(280, rowRef.current.clientWidth * 0.7), behavior: 'smooth' });
  };
  return (
    <nav className="categories-bar" aria-label="Категории">
      <div className={`container category-nav-shell${!boundaries.atStart ? ' can-scroll-left' : ''}${!boundaries.atEnd ? ' can-scroll-right' : ''}`}>
        <button type="button" className="category-scroll-button category-scroll-button--previous" disabled={boundaries.atStart} onClick={() => move(-1)} aria-label="Предыдущие категории">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div ref={rowRef} className="filter-bar" tabIndex={0} onKeyDown={handleKeyDown} aria-label="Прокручиваемый список категорий">
          {categories.map((category) => (
            <Link key={category.id} href={`/category/${category.slug}`} className="chip">
              {category.icon ? `${category.icon} ` : ''}{category.name}
            </Link>
          ))}
        </div>
        <button type="button" className="category-scroll-button category-scroll-button--next" disabled={boundaries.atEnd} onClick={() => move(1)} aria-label="Следующие категории">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </nav>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductCarousel as ProductCarouselData } from '@/lib/api-v1/types';
import { carouselBoundaryState, carouselPageStep, clampCarouselTarget } from '@/lib/carousel-scroll';
import ProductCard from './ProductCard';

export default function ProductCarousel({ carousel }: { carousel: ProductCarouselData }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [boundaries, setBoundaries] = useState({ atStart: true, atEnd: false });

  const updateBoundaries = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setBoundaries(carouselBoundaryState(track.scrollLeft, track.scrollWidth, track.clientWidth));
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollLeft = 0;
    updateBoundaries();
    track.addEventListener('scroll', updateBoundaries, { passive: true });
    const observer = new ResizeObserver(updateBoundaries);
    observer.observe(track);
    return () => {
      track.removeEventListener('scroll', updateBoundaries);
      observer.disconnect();
    };
  }, [carousel.slug, carousel.products.length, updateBoundaries]);

  if (carousel.products.length === 0) return null;

  const move = (direction: -1 | 1) => {
    const track = trackRef.current;
    const firstSlide = track?.querySelector<HTMLElement>('.featured-product-slide');
    if (!track || !firstSlide) return;
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap || '0') || 0;
    const step = carouselPageStep(track.clientWidth, firstSlide.getBoundingClientRect().width, gap);
    const target = clampCarouselTarget(track.scrollLeft + direction * step, track.scrollWidth, track.clientWidth);
    track.scrollTo({ left: target, behavior: 'smooth' });
  };

  const titleId = `product-carousel-${carousel.slug}`;

  return (
    <section className="featured-products-section" aria-labelledby={titleId}>
      <div className="featured-products-heading">
        <h2 id={titleId} className="section-title">{carousel.title}</h2>
        <div className="featured-products-controls">
          <button type="button" disabled={boundaries.atStart} onClick={() => move(-1)} aria-label={`Предыдущие товары: ${carousel.title}`}>←</button>
          <button type="button" disabled={boundaries.atEnd} onClick={() => move(1)} aria-label={`Следующие товары: ${carousel.title}`}>→</button>
        </div>
      </div>
      <div
        className="featured-products-track"
        ref={trackRef}
        tabIndex={0}
        role="region"
        aria-label={`Карусель: ${carousel.title}`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(event.key === 'ArrowLeft' ? -1 : 1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            trackRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
          } else if (event.key === 'End' && trackRef.current) {
            event.preventDefault();
            const track = trackRef.current;
            track.scrollTo({ left: track.scrollWidth - track.clientWidth, behavior: 'smooth' });
          }
        }}
      >
        {carousel.products.map((product) => (
          <div className="featured-product-slide" key={product.medicine_id}>
            <ProductCard item={product} imageUrl={product.image_url} />
          </div>
        ))}
      </div>
    </section>
  );
}

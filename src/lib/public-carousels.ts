/** Whitelisted public projection of homepage product carousels (used by the iOS JSON route).
 *
 * Pure module: no server-only or Next.js imports so it can be unit-tested with `node --test`.
 * Only the listed fields are copied; unknown or future upstream fields never leak.
 * Upstream order is preserved (Lambda sorts carousels and items); nothing is re-sorted here.
 */
import type { ProductCarousel } from './api-v1/types';

export interface PublicCarouselProductDto {
  medicine_id: number;
  medicine_name: string;
  selling_unit_price: number;
  currency: 'TJS';
  in_stock: boolean;
  image_url: string | null;
  sort_order: number;
}

export interface PublicCarouselDto {
  slug: string;
  title: string;
  sort_order: number;
  products: PublicCarouselProductDto[];
}

export interface PublicCarouselsPayload {
  carousels: PublicCarouselDto[];
}

export function toPublicCarouselsPayload(carousels: ProductCarousel[] | null | undefined): PublicCarouselsPayload {
  const result: PublicCarouselDto[] = [];
  for (const carousel of carousels ?? []) {
    const products = Array.isArray(carousel?.products) ? carousel.products : [];
    if (products.length === 0) continue;
    result.push({
      slug: carousel.slug,
      title: carousel.title,
      sort_order: carousel.sort_order,
      products: products.map((product) => ({
        medicine_id: product.medicine_id,
        medicine_name: product.medicine_name,
        selling_unit_price: product.selling_unit_price,
        currency: 'TJS',
        in_stock: product.in_stock,
        image_url: product.image_url ?? null,
        sort_order: product.sort_order,
      })),
    });
  }
  return { carousels: result };
}

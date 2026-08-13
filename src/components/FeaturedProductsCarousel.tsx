import type { FeaturedProduct } from '@/lib/api-v1/types';
import ProductCarousel from './ProductCarousel';

export default function FeaturedProductsCarousel({ products }: { products: FeaturedProduct[] }) {
  return <ProductCarousel carousel={{ slug: 'items-of-the-day', title: 'Товары дня', sort_order: 0, products }} />;
}

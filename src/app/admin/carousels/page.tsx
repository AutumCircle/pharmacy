import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminProductCarouselItems, listAdminProductCarousels } from '@/lib/api-v1/admin-server';
import type { AdminCarouselProduct, AdminNumberedPage, AdminProductCarousel } from '@/lib/api-v1/admin-types';
import CarouselsClient from './CarouselsClient';

export const dynamic = 'force-dynamic';

export default async function AdminCarouselsPage() {
  await requireAdminSession();
  let carousels: AdminProductCarousel[] | null = null;
  let initialProducts: AdminCarouselProduct[] = [];
  let initialProductsPage: AdminNumberedPage = { number: 1, size: 20, total_items: 0, total_pages: 1 };
  try {
    carousels = (await listAdminProductCarousels()).data;
    if (carousels[0]) {
      const response = await listAdminProductCarouselItems(carousels[0].id, { page: 1, limit: 20 });
      initialProducts = response.data;
      initialProductsPage = response.page;
    }
  } catch (error) {
    console.error('Failed to load product carousels', error);
  }
  if (carousels) return <CarouselsClient initialCarousels={carousels} initialProducts={initialProducts} initialProductsPage={initialProductsPage} />;
  return (
    <div style={{ background: 'white', border: '1px solid #f2c7c7', borderRadius: 12, padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Карусели пока недоступны</h1>
      <p style={{ marginBottom: 0, color: '#666' }}>Примените миграцию 0005 и разверните обновлённые Public/Admin Lambda.</p>
    </div>
  );
}

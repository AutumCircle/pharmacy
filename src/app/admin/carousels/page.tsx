import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminProductCarousels } from '@/lib/api-v1/admin-server';
import type { AdminProductCarousel } from '@/lib/api-v1/admin-types';
import CarouselsClient from './CarouselsClient';

export const dynamic = 'force-dynamic';

export default async function AdminCarouselsPage() {
  await requireAdminSession();
  let carousels: AdminProductCarousel[] | null = null;
  try {
    carousels = (await listAdminProductCarousels()).data;
  } catch (error) {
    console.error('Failed to load product carousels', error);
  }
  if (carousels) return <CarouselsClient initialCarousels={carousels} />;
  return (
    <div style={{ background: 'white', border: '1px solid #f2c7c7', borderRadius: 12, padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Карусели пока недоступны</h1>
      <p style={{ marginBottom: 0, color: '#666' }}>Примените миграцию 0005 и разверните обновлённые Public/Admin Lambda.</p>
    </div>
  );
}

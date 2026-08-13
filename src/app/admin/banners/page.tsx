import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminHomepageBanners } from '@/lib/api-v1/admin-server';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';
import BannersClient from './BannersClient';

export const dynamic = 'force-dynamic';

export default async function AdminBannersPage() {
  await requireAdminSession();
  let banners: AdminHomepageBanner[] | null = null;
  try {
    const response = await listAdminHomepageBanners();
    banners = response.data;
  } catch (error) {
    console.error('Failed to load homepage banners', error);
  }
  if (banners) return <BannersClient banners={banners} />;
  return (
    <div style={{ background: 'white', border: '1px solid #f2c7c7', borderRadius: 12, padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Баннеры пока недоступны</h1>
      <p style={{ marginBottom: 0, color: '#666' }}>
        Сначала примените миграцию 0003 и разверните новую версию Admin Lambda.
      </p>
    </div>
  );
}

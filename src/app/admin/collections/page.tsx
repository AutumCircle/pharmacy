import { requireAdminSession } from '@/lib/admin-auth';
import { listAdminCollections } from '@/lib/api-v1/admin-server';
import type { AdminCollection } from '@/lib/api-v1/admin-types';
import { getSiteUrl } from '@/lib/seo';
import CollectionsClient from './CollectionsClient';

export const dynamic = 'force-dynamic';

export default async function AdminCollectionsPage() {
  await requireAdminSession();
  let collections: AdminCollection[] | null = null;
  try {
    collections = (await listAdminCollections()).data;
  } catch (error) {
    console.error('Failed to load collections', error);
  }
  if (collections) return <CollectionsClient initialCollections={collections} siteUrl={getSiteUrl()} />;
  return (
    <div style={{ background: 'white', border: '1px solid #f2c7c7', borderRadius: 12, padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Подборки пока недоступны</h1>
      <p style={{ marginBottom: 0, color: '#666' }}>Примените миграцию 0019 и разверните обновлённые Public/Admin Lambda.</p>
    </div>
  );
}

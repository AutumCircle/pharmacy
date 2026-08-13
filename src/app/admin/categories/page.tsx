import CategoriesClient from './CategoriesClient';
import { listAdminCategories } from '@/lib/api-v1/admin-server';
import { requireAdminSession } from '@/lib/admin-auth';
import type { AdminCategory } from '@/lib/api-v1/admin-types';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  let initialCategories: AdminCategory[] = [];
  try {
    await requireAdminSession();
    initialCategories = (await listAdminCategories()).data;
  } catch (e) {
    console.error('Failed to fetch categories', e);
  }

  return (
    <div>
      <CategoriesClient initialCategories={initialCategories} />
    </div>
  );
}

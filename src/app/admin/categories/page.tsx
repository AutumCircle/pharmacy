import CategoriesClient from './CategoriesClient';
import { listAdminCategories, listAdminCategoryMedicines } from '@/lib/api-v1/admin-server';
import { requireAdminSession } from '@/lib/admin-auth';
import type { AdminCategory, AdminCategoryMedicine, AdminNumberedPage } from '@/lib/api-v1/admin-types';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  let initialCategories: AdminCategory[] = [];
  let initialItems: AdminCategoryMedicine[] = [];
  let initialItemsPage: AdminNumberedPage = { number: 1, size: 25, total_items: 0, total_pages: 1 };
  try {
    await requireAdminSession();
    initialCategories = (await listAdminCategories()).data;
    if (initialCategories[0]) {
      const response = await listAdminCategoryMedicines(initialCategories[0].id, { page: 1, limit: 25 });
      initialItems = response.data;
      initialItemsPage = response.page;
    }
  } catch (e) {
    console.error('Failed to fetch categories', e);
  }

  return (
    <div>
      <CategoriesClient initialCategories={initialCategories} initialItems={initialItems} initialItemsPage={initialItemsPage} />
    </div>
  );
}

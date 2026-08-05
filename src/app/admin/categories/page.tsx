import CategoriesClient from './CategoriesClient';
import { fetchAdminData } from '../../../lib/api';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  let initialCategories = [];
  try {
    const res = await fetchAdminData('list_categories');
    initialCategories = res?.categories || [];
  } catch (e) {
    console.error('Failed to fetch categories', e);
  }

  return (
    <div>
      <CategoriesClient initialCategories={initialCategories} />
    </div>
  );
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  createAdminFeaturedProduct,
  deleteAdminFeaturedProduct,
  listAdminMedicines,
  updateAdminFeaturedProduct,
} from '@/lib/api-v1/admin-server';

function failure(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : 'Неизвестная ошибка' };
}

function revalidateFeatured() {
  revalidatePath('/');
  revalidatePath('/admin/featured');
}

export async function searchFeaturedCandidates(query: string) {
  try {
    await requireAdminSession();
    const q = query.trim();
    if (q.length < 2) return { success: true as const, items: [] };
    const response = await listAdminMedicines({ q, availability: 'all', page: 1, limit: 20 });
    return { success: true as const, items: response.data };
  } catch (error) {
    return failure(error);
  }
}

export async function addFeaturedProduct(medicineId: number, sortOrder: number) {
  try {
    await requireAdminSession();
    const response = await createAdminFeaturedProduct({ medicine_id: medicineId, image_url: null, sort_order: sortOrder });
    revalidateFeatured();
    return { success: true as const, product: response.data };
  } catch (error) {
    return failure(error);
  }
}

export async function saveFeaturedProduct(medicineId: number, imageUrl: string, sortOrder: number) {
  try {
    await requireAdminSession();
    const response = await updateAdminFeaturedProduct(medicineId, {
      image_url: imageUrl.trim() || null,
      sort_order: sortOrder,
    });
    revalidateFeatured();
    return { success: true as const, product: response.data };
  } catch (error) {
    return failure(error);
  }
}

export async function removeFeaturedProduct(medicineId: number) {
  try {
    await requireAdminSession();
    await deleteAdminFeaturedProduct(medicineId);
    revalidateFeatured();
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

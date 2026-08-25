'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  batchAddAdminCategoryMedicines,
  batchRemoveAdminCategoryMedicines,
  bulkAddAdminCategoryMedicines,
  createAdminCategory,
  deleteAdminCategory,
  deleteAdminCategoryMedicine,
  listAdminCategories,
  listAdminMedicines,
  listAdminCategoryMedicines,
  putAdminCategoryMedicine,
  previewAdminCategoryMedicineBulkAdd,
  reorderAdminCategories,
  searchAdminCategoryMedicineCandidates,
  updateAdminCategory,
} from '@/lib/api-v1/admin-server';

function failure(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : 'Unknown error' };
}

export async function deleteCategory(id: number) {
  try {
    await requireAdminSession();
    await deleteAdminCategory(id);
    revalidatePath('/');
    revalidatePath('/catalog');
    revalidatePath('/admin');
    revalidatePath('/admin/categories');
    return { success: true as const, message: 'Категория удалена' };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function createCategory(data: { slug: string; name: string; icon?: string; color?: string; sort_order?: number }) {
  try {
    await requireAdminSession();
    const response = await createAdminCategory(data);
    revalidatePath('/admin/categories');
    return { success: true as const, category: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function updateCategory(data: {
  id: number; name?: string; icon?: string; color?: string; sort_order?: number; is_active?: boolean;
}) {
  try {
    await requireAdminSession();
    const { id, ...updates } = data;
    const response = await updateAdminCategory(id, updates);
    revalidatePath('/admin/categories');
    return { success: true as const, category: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function disableCategory(id: number) {
  return updateCategory({ id, is_active: false });
}

export async function searchMedicinesForCategory(query: string) {
  try {
    await requireAdminSession();
    const q = query.trim();
    if (q.length < 2) return { success: true as const, items: [] };
    const response = await listAdminMedicines({ q, availability: 'all', page: 1, limit: 20 });
    return { success: true as const, items: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function getCategoryMedicines(
  categoryId: number,
  page = 1,
  q = '',
  availability: 'all' | 'in_stock' | 'out_of_stock' = 'all',
) {
  try {
    await requireAdminSession();
    const response = await listAdminCategoryMedicines(categoryId, { page, limit: 25, q: q.trim(), availability });
    return { success: true as const, items: response.data, page: response.page };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function searchCategoryMedicineCandidates(categoryId: number, query: string, page = 1) {
  try {
    await requireAdminSession();
    const response = await searchAdminCategoryMedicineCandidates(categoryId, query.trim(), page, 25);
    return { success: true as const, items: response.data, page: response.page };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function addSelectedCategoryMedicines(categoryId: number, medicineIds: number[]) {
  try {
    await requireAdminSession();
    const response = await batchAddAdminCategoryMedicines(categoryId, medicineIds);
    revalidatePath('/');
    revalidatePath('/catalog');
    revalidatePath('/admin/categories');
    return { success: true as const, result: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function removeSelectedCategoryMedicines(categoryId: number, medicineIds: number[]) {
  try {
    await requireAdminSession();
    const response = await batchRemoveAdminCategoryMedicines(categoryId, medicineIds);
    revalidatePath('/');
    revalidatePath('/catalog');
    revalidatePath('/admin/categories');
    return { success: true as const, result: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function reorderCategories(categoryIds: number[]) {
  try {
    await requireAdminSession();
    await reorderAdminCategories(categoryIds);
    revalidatePath('/');
    revalidatePath('/catalog');
    revalidatePath('/admin/categories');
    const response = await listAdminCategories();
    return { success: true as const, categories: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function addCategoryMedicine(categoryId: number, medicineId: number) {
  try {
    await requireAdminSession();
    await putAdminCategoryMedicine(categoryId, medicineId);
    revalidatePath('/admin/categories');
    return { success: true as const };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function removeCategoryMedicine(categoryId: number, medicineId: number) {
  try {
    await requireAdminSession();
    await deleteAdminCategoryMedicine(categoryId, medicineId);
    revalidatePath('/admin/categories');
    return { success: true as const };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function previewCategoryMedicineBulkAdd(categoryId: number, fragment: string, page = 1) {
  try {
    await requireAdminSession();
    const response = await previewAdminCategoryMedicineBulkAdd(categoryId, fragment, page, 20);
    return { success: true as const, preview: response };
  } catch (error: unknown) {
    return failure(error);
  }
}

export async function bulkAddCategoryMedicines(
  categoryId: number,
  fragment: string,
  confirmedCount: number,
) {
  try {
    await requireAdminSession();
    const response = await bulkAddAdminCategoryMedicines(categoryId, fragment, confirmedCount);
    revalidatePath('/');
    revalidatePath('/catalog');
    revalidatePath('/admin/categories');
    return { success: true as const, result: response.data };
  } catch (error: unknown) {
    return failure(error);
  }
}

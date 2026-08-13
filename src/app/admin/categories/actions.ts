'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  createAdminCategory,
  deleteAdminCategory,
  deleteAdminCategoryMedicine,
  listAdminMedicines,
  listAdminCategoryMedicines,
  putAdminCategoryMedicine,
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

export async function getCategoryMedicines(categoryId: number) {
  try {
    await requireAdminSession();
    const response = await listAdminCategoryMedicines(categoryId);
    return { success: true as const, items: response.data };
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

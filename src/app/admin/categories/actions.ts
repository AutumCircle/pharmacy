'use server';

import { fetchAdminData } from '../../../lib/api';
import { revalidatePath } from 'next/cache';

export async function createCategory(data: { slug: string, name: string, icon?: string, color?: string }) {
  try {
    await fetchAdminData('create_category', data);
    revalidatePath('/admin/categories');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function updateCategory(data: { id: number, name?: string, icon?: string, color?: string, is_active?: boolean }) {
  try {
    await fetchAdminData('update_category', data);
    revalidatePath('/admin/categories');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteCategory(id: number) {
  try {
    await fetchAdminData('delete_category', { id });
    revalidatePath('/admin/categories');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getCategoryMedicines(slug: string) {
  try {
    const res = await fetchAdminData('get_category_medicines', { slug });
    return { success: true, items: res?.items || [] };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function addCategoryMedicine(slug: string, medicine_name: string) {
  try {
    await fetchAdminData('add_category_medicine', { slug, medicine_name });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function removeCategoryMedicine(slug: string, medicine_name: string) {
  try {
    await fetchAdminData('remove_category_medicine', { slug, medicine_name });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  addAdminProductCarouselItem,
  createAdminProductCarousel,
  deleteAdminProductCarousel,
  deleteAdminProductCarouselItem,
  listAdminMedicines,
  listAdminProductCarousels,
  updateAdminProductCarousel,
  updateAdminProductCarouselItem,
} from '@/lib/api-v1/admin-server';

function failure(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : 'Неизвестная ошибка' };
}

async function refreshed() {
  revalidatePath('/');
  revalidatePath('/admin/carousels');
  return (await listAdminProductCarousels()).data;
}

export async function searchCarouselCandidates(query: string) {
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

export async function createCarousel(slug: string, title: string, sortOrder: number) {
  try {
    await requireAdminSession();
    await createAdminProductCarousel({ slug: slug.trim(), title: title.trim(), is_active: true, sort_order: sortOrder });
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCarousel(carouselId: number, title: string, active: boolean, sortOrder: number) {
  try {
    await requireAdminSession();
    await updateAdminProductCarousel(carouselId, { title: title.trim(), is_active: active, sort_order: sortOrder });
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function removeCarousel(carouselId: number) {
  try {
    await requireAdminSession();
    await deleteAdminProductCarousel(carouselId);
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function addCarouselProduct(carouselId: number, medicineId: number, sortOrder: number) {
  try {
    await requireAdminSession();
    await addAdminProductCarouselItem(carouselId, medicineId, sortOrder);
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCarouselProduct(
  carouselId: number,
  medicineId: number,
  sortOrder: number,
  imageUrl: string,
) {
  try {
    await requireAdminSession();
    await updateAdminProductCarouselItem(carouselId, medicineId, {
      sort_order: sortOrder,
      image_url: imageUrl.trim() || null,
    });
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function removeCarouselProduct(carouselId: number, medicineId: number) {
  try {
    await requireAdminSession();
    await deleteAdminProductCarouselItem(carouselId, medicineId);
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

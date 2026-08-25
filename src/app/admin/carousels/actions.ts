'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  addAdminProductCarouselItem,
  batchAddAdminProductCarouselItems,
  batchRemoveAdminProductCarouselItems,
  createAdminProductCarousel,
  deleteAdminProductCarousel,
  deleteAdminProductCarouselItem,
  listAdminProductCarouselItems,
  listAdminProductCarousels,
  reorderAdminProductCarouselItems,
  reorderAdminProductCarouselPage,
  reorderAdminProductCarousels,
  searchAdminProductCarouselCandidates,
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

export async function searchCarouselCandidates(carouselId: number, query: string, page = 1) {
  try {
    await requireAdminSession();
    const q = query.trim();
    if (q.length < 2) return { success: true as const, items: [] };
    const response = await searchAdminProductCarouselCandidates(carouselId, q, page, 25);
    return { success: true as const, items: response.data, page: response.page };
  } catch (error) {
    return failure(error);
  }
}

export async function getCarouselProducts(carouselId: number, page = 1, q = '') {
  try {
    await requireAdminSession();
    const response = await listAdminProductCarouselItems(carouselId, { page, limit: 20, q: q.trim() });
    return { success: true as const, items: response.data, page: response.page };
  } catch (error) {
    return failure(error);
  }
}

export async function addSelectedCarouselProducts(carouselId: number, medicineIds: number[]) {
  try {
    await requireAdminSession();
    const response = await batchAddAdminProductCarouselItems(carouselId, medicineIds);
    return { success: true as const, result: response.data, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function removeSelectedCarouselProducts(carouselId: number, medicineIds: number[]) {
  try {
    await requireAdminSession();
    const response = await batchRemoveAdminProductCarouselItems(carouselId, medicineIds);
    return { success: true as const, result: response.data, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function reorderCarouselPage(carouselId: number, medicineIds: number[]) {
  try {
    await requireAdminSession();
    await reorderAdminProductCarouselPage(carouselId, medicineIds);
    revalidatePath('/');
    revalidatePath('/admin/carousels');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function reorderCarousels(carouselIds: number[]) {
  try {
    await requireAdminSession();
    await reorderAdminProductCarousels(carouselIds);
    return { success: true as const, carousels: await refreshed() };
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

export async function reorderCarouselProducts(carouselId: number, medicineIds: number[]) {
  try {
    await requireAdminSession();
    await reorderAdminProductCarouselItems(carouselId, medicineIds);
    return { success: true as const, carousels: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

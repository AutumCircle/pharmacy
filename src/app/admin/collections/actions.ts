'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import {
  createAdminCollection,
  deleteAdminCollection,
  listAdminCollections,
  resolveAdminCollectionProducts,
  updateAdminCollection,
} from '@/lib/api-v1/admin-server';
import type { AdminCollectionInput } from '@/lib/api-v1/admin-types';

function failure(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : 'Неизвестная ошибка' };
}

async function refreshed() {
  revalidatePath('/admin/collections');
  return (await listAdminCollections()).data;
}

/** Parses "10059, 4048 8955" into ordered unique IDs; returns an error text for anything else. */
export async function parseProductIds(raw: string): Promise<{ ids: number[] } | { error: string }> {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const ids: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,9}$/.test(part) || Number(part) <= 0) return { error: `«${part}» не является ID товара` };
    const id = Number(part);
    if (ids.includes(id)) return { error: `ID ${id} указан дважды` };
    ids.push(id);
  }
  return { ids };
}

export async function previewCollectionProducts(rawIds: string) {
  try {
    await requireAdminSession();
    const parsed = await parseProductIds(rawIds);
    if ('error' in parsed) return { success: false as const, error: parsed.error };
    if (parsed.ids.length === 0) return { success: true as const, products: [], missing_ids: [] as number[] };
    const response = await resolveAdminCollectionProducts(parsed.ids);
    return { success: true as const, ...response.data };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCollection(
  collectionId: number | null,
  values: { slug: string; title: string; description: string; productIds: string; isActive: boolean },
) {
  try {
    await requireAdminSession();
    const parsed = await parseProductIds(values.productIds);
    if ('error' in parsed) return { success: false as const, error: parsed.error };
    const body: AdminCollectionInput = {
      slug: values.slug.trim().toLowerCase(),
      title: values.title.trim(),
      description: values.description.trim(),
      product_ids: parsed.ids,
      is_active: values.isActive,
    };
    if (collectionId === null) await createAdminCollection(body);
    else await updateAdminCollection(collectionId, body);
    return { success: true as const, collections: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function setCollectionActive(collectionId: number, isActive: boolean) {
  try {
    await requireAdminSession();
    await updateAdminCollection(collectionId, { is_active: isActive });
    return { success: true as const, collections: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

export async function removeCollection(collectionId: number) {
  try {
    await requireAdminSession();
    await deleteAdminCollection(collectionId);
    return { success: true as const, collections: await refreshed() };
  } catch (error) {
    return failure(error);
  }
}

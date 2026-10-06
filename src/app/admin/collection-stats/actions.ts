'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { resetAdminCollectionStats } from '@/lib/api-v1/admin-server';

export async function resetCollectionStats(confirmation: string) {
  try {
    await requireAdminSession();
    const response = await resetAdminCollectionStats(confirmation);
    revalidatePath('/admin/collection-stats');
    return { success: true as const, ...response.data };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось обнулить статистику',
    };
  }
}

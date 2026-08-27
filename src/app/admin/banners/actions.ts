'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminHomepageBanner } from '@/lib/api-v1/admin-server';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';

type BannerUpdate = Omit<AdminHomepageBanner, 'updated_at'>;

export async function saveHomepageBanner(data: BannerUpdate) {
  try {
    await requireAdminSession();
    const { slot, ...updates } = data;
    const response = await updateAdminHomepageBanner(slot, updates);
    revalidatePath('/');
    revalidatePath('/admin/banners');
    revalidatePath(`/admin/banners/${slot}`);
    return { success: true as const, banner: response.data };
  } catch (error: unknown) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось сохранить баннер',
    };
  }
}

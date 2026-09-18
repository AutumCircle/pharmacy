'use server';

import { revalidatePath } from 'next/cache';
import { saveLocalBanner } from '@/lib/local-banners';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminHomepageBanner } from '@/lib/api-v1/admin-server';
import type { AdminHomepageBanner } from '@/lib/api-v1/admin-types';

type BannerUpdate = Omit<AdminHomepageBanner, 'updated_at'>;

export async function saveHomepageBanner(data: BannerUpdate) {
  try {
    await requireAdminSession();
    if (process.env.NODE_ENV === 'development') {
      const banner = await saveLocalBanner(data);
      revalidatePath('/'); revalidatePath('/admin/banners'); revalidatePath(`/admin/banners/${data.slot}`);
      return { success: true as const, banner };
    }
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

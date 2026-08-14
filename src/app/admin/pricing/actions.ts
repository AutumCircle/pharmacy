'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminPricingSettings } from '@/lib/api-v1/admin-server';

export async function savePricingSettings(enabled: boolean, percent: number) {
  try {
    await requireAdminSession();
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { success: false as const, error: 'Процент должен быть от 0 до 100' };
    }
    const response = await updateAdminPricingSettings({
      markup_enabled: enabled,
      markup_percent: percent,
    });
    revalidatePath('/');
    revalidatePath('/admin/pricing');
    revalidatePath('/admin/medicines');
    return { success: true as const, settings: response.data };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось сохранить настройки цены',
    };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { previewAdminNotificationSettings, updateAdminNotificationSettings } from '@/lib/api-v1/admin-server';
import type { AdminNotificationSettings } from '@/lib/api-v1/admin-types';

export async function saveNotificationSettings(body: Pick<AdminNotificationSettings, 'courier_enabled' | 'policies' | 'revision'>) {
  try {
    await requireAdminSession();
    const response = await updateAdminNotificationSettings(body);
    revalidatePath('/admin/order-notifications');
    revalidatePath('/staff/orders');
    return { success: true as const, settings: response.data };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Не удалось сохранить настройки' };
  }
}

export async function previewNotificationSettings(body: Pick<AdminNotificationSettings, 'courier_enabled' | 'policies' | 'revision'>) {
  try {
    await requireAdminSession();
    const response = await previewAdminNotificationSettings(body);
    return { success: true as const, preview: response.data };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Не удалось показать пример' };
  }
}

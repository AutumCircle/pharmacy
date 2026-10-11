'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminNotificationSettings } from '@/lib/api-v1/admin-server';
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

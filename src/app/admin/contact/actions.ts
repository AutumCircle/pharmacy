'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminContactSettings } from '@/lib/api-v1/admin-server';

export async function saveDeliveryContactPhone(phone: string) {
  try {
    await requireAdminSession();
    const digits = phone.replace(/\D/g, '').replace(/^992/, '');
    if (!/^\d{9}$/.test(digits)) {
      return { success: false as const, error: 'Введите 9 цифр номера Таджикистана' };
    }
    const response = await updateAdminContactSettings(`+992${digits}`);
    revalidatePath('/admin/contact');
    revalidatePath('/');
    revalidatePath('/cart');
    return { success: true as const, settings: response.data };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Не удалось сохранить номер' };
  }
}

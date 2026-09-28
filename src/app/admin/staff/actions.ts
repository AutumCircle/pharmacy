'use server';

import { requireAdminSession } from '@/lib/admin-auth';
import { updateStaffAccount } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import { revalidatePath } from 'next/cache';

export async function saveStaffAccount(accountId: number, username: string, password?: string) {
  try {
    await requireAdminSession();
    if (![1, 2].includes(accountId) || typeof username !== 'string'
      || (password !== undefined && typeof password !== 'string')) return { error: 'Некорректные данные' };
    await updateStaffAccount(accountId, { username, ...(password ? { password } : {}) });
    revalidatePath('/admin/staff');
    return { success: true };
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 409) return { error: 'Этот логин уже используется' };
    if (error instanceof ApiV1Error && error.status === 400) return { error: error.message };
    return { error: 'Не удалось сохранить изменения. Проверьте авторизацию и повторите попытку.' };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { deleteAdminOrder, updateAdminOrderStatus, updateAdminOrderTotal } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import type { OrderStatus } from '@/lib/api-v1/types';

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  expectedCurrentStatus: OrderStatus,
  reason?: string,
) {
  try {
    await requireAdminSession();
    await updateAdminOrderStatus(orderId, status, expectedCurrentStatus, reason);
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true as const };
  } catch (error: unknown) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function updateOrderTotal(orderId: string, orderTotal: number) {
  try {
    await requireAdminSession();
    if (!Number.isFinite(orderTotal) || orderTotal <= 0 || orderTotal > 10_000_000) {
      return { success: false as const, error: 'Введите корректную итоговую цену' };
    }
    const response = await updateAdminOrderTotal(orderId, orderTotal);
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true as const, orderTotal: Number(response.data.order_total) };
  } catch (error: unknown) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось изменить цену заказа',
    };
  }
}

export async function deleteOrder(orderId: string) {
  try {
    await requireAdminSession();
    await deleteAdminOrder(orderId);
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true as const, message: 'Заказ удалён из рабочих списков' };
  } catch (error: unknown) {
    return {
      success: false as const,
      code: error instanceof ApiV1Error ? error.code : 'UNKNOWN_ERROR',
      error: error instanceof Error ? error.message : 'Не удалось удалить заказ',
    };
  }
}

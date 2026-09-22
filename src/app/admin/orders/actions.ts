'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { deleteAdminOrder, updateAdminOrderItemPrice, updateAdminOrderStatus } from '@/lib/api-v1/admin-server';
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

export async function updateOrderItemPrice(orderId: string, orderItemId: number, sellingUnitPrice: number) {
  try {
    await requireAdminSession();
    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
      return { success: false as const, error: 'Товар заказа не найден' };
    }
    if (!Number.isFinite(sellingUnitPrice) || sellingUnitPrice <= 0 || sellingUnitPrice > 10_000_000) {
      return { success: false as const, error: 'Введите корректную цену продажи' };
    }
    const response = await updateAdminOrderItemPrice(orderId, orderItemId, sellingUnitPrice);
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true as const, sellingUnitPrice: Number(response.data.selling_unit_price) };
  } catch (error: unknown) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось изменить цену товара',
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

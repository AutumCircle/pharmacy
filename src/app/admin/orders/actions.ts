'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminSession } from '@/lib/admin-auth';
import { addAdminOrderItems, deleteAdminOrder, searchAdminOrderMedicines, updateAdminOrderDelivery, updateAdminOrderItemPrice, updateAdminOrderStatus } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import type { OrderStatus } from '@/lib/api-v1/types';

export async function searchOrderMedicines(query: string) {
  try {
    await requireAdminSession();
    if (query.trim().length < 2 || query.trim().length > 120) throw new Error('Введите от 2 до 120 символов');
    return { success: true as const, medicines: (await searchAdminOrderMedicines(query.trim())).data };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Не удалось найти лекарства' };
  }
}

export async function addOrderMedicines(orderId: string, items: Array<{ medicine_id: number; quantity: number }>, idempotencyKey: string) {
  try {
    await requireAdminSession();
    if (!Array.isArray(items) || items.length < 1 || items.length > 20 ||
      items.some((item) => !Number.isInteger(item.medicine_id) || item.medicine_id <= 0 ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) throw new Error('Проверьте лекарства и количество');
    const response = await addAdminOrderItems(orderId, items, idempotencyKey);
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true as const, added: response.data.added, increased: response.data.quantity_increased };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Не удалось добавить лекарства' };
  }
}

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

export async function updateOrderItemPrice(
  orderId: string,
  orderItemId: number,
  prices: { sellingUnitPrice?: number; baseUnitPrice?: number },
) {
  try {
    await requireAdminSession();
    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
      return { success: false as const, error: 'Товар заказа не найден' };
    }
    const valid = (value: number | undefined) =>
      value === undefined || (Number.isFinite(value) && value > 0 && value <= 10_000_000);
    if ((prices.sellingUnitPrice === undefined && prices.baseUnitPrice === undefined)
      || !valid(prices.sellingUnitPrice) || !valid(prices.baseUnitPrice)) {
      return { success: false as const, error: 'Введите корректную цену' };
    }
    const response = await updateAdminOrderItemPrice(orderId, orderItemId, prices);
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return {
      success: true as const,
      sellingUnitPrice: Number(response.data.selling_unit_price),
      baseUnitPrice: Number(response.data.base_unit_price),
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось изменить цену товара',
    };
  }
}

export async function updateOrderDelivery(orderId: string, courierAmount: number, ownerAmount: number) {
  try {
    await requireAdminSession();
    const valid = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1_000_000;
    if (!valid(courierAmount) || !valid(ownerAmount)) {
      return { success: false as const, error: 'Введите корректную сумму доставки' };
    }
    await updateAdminOrderDelivery(orderId, courierAmount, ownerAmount);
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { success: true as const };
  } catch (error: unknown) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Не удалось сохранить доставку',
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

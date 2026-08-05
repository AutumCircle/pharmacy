'use server';

import { fetchAdminData } from '../../../lib/api';
import { revalidatePath } from 'next/cache';

export async function updateOrderStatus(orderId: string, status: string) {
  try {
    await fetchAdminData('update_order', { order_id: orderId, status });
    revalidatePath('/admin/orders');
    return { success: true };
  } catch (err: any) {
    console.error("Update order error:", err);
    return { success: false, error: err.message };
  }
}

export async function deleteAllOrders() {
  try {
    await fetchAdminData('delete_all_orders');
    revalidatePath('/admin/orders');
    return { success: true };
  } catch (err: any) {
    console.error("Delete all orders error:", err);
    return { success: false, error: err.message };
  }
}

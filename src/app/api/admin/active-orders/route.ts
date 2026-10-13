import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-session';
import { listAdminOrders } from '@/lib/api-v1/admin-server';

export async function GET() {
  const cookieStore = await cookies();
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!secret || !(await verifyAdminSession(token, secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const orders = (await listAdminOrders({ status: 'active', limit: 100 })).data;
    const pending = orders.filter((order) => order.status === 'pending').map((order) => ({
      order_id: order.order_id, order_reference: order.order_reference, customer_name: order.customer_name,
      order_total: order.order_total, website: order.created_by_staff_account_id === null,
    }));
    return NextResponse.json({ activeCount: orders.length, pending }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ activeCount: 0, pending: [] });
  }
}

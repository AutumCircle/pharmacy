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
    const orders = (await listAdminOrders({ limit: 100 })).data;
    const activeCount = orders.filter((order) => order.status !== 'delivered' && order.status !== 'cancelled').length;
    return NextResponse.json({ activeCount });
  } catch {
    return NextResponse.json({ activeCount: 0 });
  }
}

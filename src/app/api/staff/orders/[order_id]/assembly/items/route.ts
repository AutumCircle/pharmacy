import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { collectPharmacyOrderItem } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { validateItemCollectRequest } from '@/lib/pharmacy-assembly';

// Per-item «Собрано» (job 011 rework 1). Only pre-validates; Lambda takes the pharmacy id from the
// staff session and checks that the item is this pharmacy's and answered «В наличии».
export async function POST(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json().catch(() => null);
    const checked = validateItemCollectRequest(body);
    if (!checked.ok) return NextResponse.json({ error: { message: checked.error } }, { status: 400 });
    const response = await collectPharmacyOrderItem(token, order_id, checked.value);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

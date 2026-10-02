import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { updateCourierDeliveryAmount } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function PATCH(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json();
    const amount = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).delivery_courier_amount : undefined;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
      return NextResponse.json({ error: { message: 'Неверная сумма доставки' } }, { status: 400 });
    }
    const response = await updateCourierDeliveryAmount(token, order_id, amount);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

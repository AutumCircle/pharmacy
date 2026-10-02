import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { updateCourierOrderStatus } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import type { CourierOrderStatus } from '@/lib/api-v1/staff-types';

const statuses: CourierOrderStatus[] = ['pending', 'confirmed', 'delivering', 'delivered', 'cancelled'];

export async function PATCH(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: { message: 'Неверный запрос' } }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some((key) => !['status', 'expected_current_status', 'reason'].includes(key))
      || !statuses.includes(data.status as CourierOrderStatus)
      || !statuses.includes(data.expected_current_status as CourierOrderStatus)
      || (data.reason !== undefined && (typeof data.reason !== 'string' || data.reason.length > 500))) {
      return NextResponse.json({ error: { message: 'Неверный статус' } }, { status: 400 });
    }
    const response = await updateCourierOrderStatus(token, order_id, {
      status: data.status as CourierOrderStatus,
      expected_current_status: data.expected_current_status as CourierOrderStatus,
      ...(data.reason !== undefined ? { reason: data.reason as string } : {}),
    });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

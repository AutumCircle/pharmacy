import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { getStaffSession, updateCourierOrderCustomer } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function PATCH(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const account = await getStaffSession(token);
    if (account.role !== 'courier') return NextResponse.json({ error: { message: 'Доступ запрещён' } }, { status: 403 });
    const { order_id } = await params;
    if (!/^(?:ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json();
    const fields = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!fields || Object.keys(fields).length !== 2 || typeof fields.customer_name !== 'string'
      || fields.customer_name.trim().length > 120 || typeof fields.phone !== 'string' || !/^\d{9}$/.test(fields.phone)) {
      return NextResponse.json({ error: { message: 'Проверьте имя и телефон (9 цифр)' } }, { status: 400 });
    }
    const response = await updateCourierOrderCustomer(token, order_id,
      { customer_name: fields.customer_name.trim(), phone: fields.phone });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

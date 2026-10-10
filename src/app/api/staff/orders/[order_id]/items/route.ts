import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { addCourierOrderItems, getStaffSession } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function POST(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const account = await getStaffSession(token);
    if (account.role !== 'courier') return NextResponse.json({ error: { message: 'Доступ запрещён' } }, { status: 403 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) return NextResponse.json({ error: { message: 'Повторите отправку' } }, { status: 400 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
      || !('items' in body) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20
      || !body.items.every((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const fields = item as Record<string, unknown>;
        return Object.keys(fields).length === 2 && Number.isInteger(fields.medicine_id)
          && Number(fields.medicine_id) > 0 && Number.isInteger(fields.quantity)
          && Number(fields.quantity) >= 1 && Number(fields.quantity) <= 99;
      })) {
      return NextResponse.json({ error: { message: 'Проверьте лекарства и количество' } }, { status: 400 });
    }
    const response = await addCourierOrderItems(token, order_id, body.items, idempotencyKey);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { addCourierManualOrderItems, getStaffSession } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function POST(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const account = await getStaffSession(token);
    if (account.role !== 'courier') return NextResponse.json({ error: { message: 'Доступ запрещён' } }, { status: 403 });
    const { order_id } = await params;
    if (!/^(?:ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) return NextResponse.json({ error: { message: 'Повторите отправку' } }, { status: 400 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
      !('manual_items' in body) || !Array.isArray(body.manual_items) ||
      body.manual_items.length < 1 || body.manual_items.length > 20 ||
      !body.manual_items.every((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const fields = item as Record<string, unknown>;
        return Object.keys(fields).length === 3 && typeof fields.medicine_name === 'string' &&
          fields.medicine_name.trim().length >= 2 && fields.medicine_name.trim().length <= 200 &&
          typeof fields.price === 'string' && /^\d{1,6}(?:\.\d{1,2})?$/.test(fields.price) &&
          Number(fields.price) > 0 && typeof fields.quantity === 'number' && Number.isFinite(fields.quantity) &&
          fields.quantity >= 0.5 && fields.quantity <= 99 && Number.isInteger(fields.quantity * 2);
      })) {
      return NextResponse.json({ error: { message: 'Проверьте название, цену и количество' } }, { status: 400 });
    }
    const result = await addCourierManualOrderItems(token, order_id, body.manual_items, idempotencyKey);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { getStaffSession, updateCourierOrderItem } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { isOrderPrice, isOrderQuantity } from '@/lib/staff-order-items';

type Params = { params: Promise<{ order_id: string; item_id: string }> };

async function target(params: Params['params']) {
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return { error: NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 }) };
  const account = await getStaffSession(token);
  if (account.role !== 'courier') return { error: NextResponse.json({ error: { message: 'Доступ запрещён' } }, { status: 403 }) };
  const { order_id, item_id } = await params;
  if (!/^(?:ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)$/.test(order_id) || !/^[1-9][0-9]{0,17}$/.test(item_id)) {
    return { error: NextResponse.json({ error: { message: 'Товар не найден' } }, { status: 400 }) };
  }
  return { token, orderId: order_id, itemId: Number(item_id) };
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const resolved = await target(params);
    if ('error' in resolved) return resolved.error;
    const body: unknown = await request.json();
    const fields = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    const keys = fields ? Object.keys(fields) : [];
    if (!fields || keys.length === 0 || keys.some((key) => key !== 'quantity' && key !== 'unit_price')
      || (fields.quantity !== undefined && !isOrderQuantity(fields.quantity))
      || (fields.unit_price !== undefined && !isOrderPrice(fields.unit_price))) {
      return NextResponse.json({ error: { message: 'Проверьте количество и цену' } }, { status: 400 });
    }
    const response = await updateCourierOrderItem(resolved.token, resolved.orderId, resolved.itemId,
      fields as { quantity?: number; unit_price?: string });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const resolved = await target(params);
    if ('error' in resolved) return resolved.error;
    const response = await updateCourierOrderItem(resolved.token, resolved.orderId, resolved.itemId, null);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

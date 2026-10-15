import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { updateCourierOrderChecklist } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { isManualStep } from '@/lib/courier-checklist';

export async function PATCH(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: { message: 'Неверный запрос' } }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some((key) => key !== 'step' && key !== 'done') || typeof data.done !== 'boolean') {
      return NextResponse.json({ error: { message: 'Неверная отметка шага' } }, { status: 400 });
    }
    if (!Number.isInteger(data.step) || (data.step as number) < 1 || (data.step as number) > 7) {
      return NextResponse.json({ error: { message: 'Шаг должен быть числом от 1 до 7' } }, { status: 400 });
    }
    if (!isManualStep(data.step)) {
      return NextResponse.json({ error: { message: 'Этот шаг отмечается сменой статуса заказа' } }, { status: 400 });
    }
    const response = await updateCourierOrderChecklist(token, order_id, { step: data.step, done: data.done });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

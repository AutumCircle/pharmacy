import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-session';
import { createStaffOrder } from '@/lib/api-v1/staff-server';
import { sendOrderNotification } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import type { CreateStaffOrderRequest } from '@/lib/api-v1/staff-types';

function isRequest(value: unknown): value is CreateStaffOrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = new Set(['customer_name', 'phone', 'address', 'landmark', 'source']);
  return Object.keys(body).every((key) => allowed.has(key))
    && (body.customer_name === undefined || typeof body.customer_name === 'string')
    && typeof body.phone === 'string' && /^\d{9}$/.test(body.phone)
    && typeof body.address === 'string' && typeof body.landmark === 'string'
    && ['instagram', 'whatsapp', 'phone'].includes(String(body.source));
}

export async function POST(request: Request) {
  try {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: 'Требуется вход' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) return NextResponse.json({ error: 'Повторите отправку' }, { status: 400 });
    const body: unknown = await request.json();
    if (!isRequest(body)) return NextResponse.json({ error: 'Проверьте обязательные поля' }, { status: 400 });
    const response = await createStaffOrder(token, body, idempotencyKey);
    const notification = response.data._notification;
    delete response.data._notification;
    if (notification) {
      try {
        await sendOrderNotification(notification);
      } catch (error) {
        console.error('Staff order was created, but notification failed', error);
      }
    }
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return apiRouteError(error);
  }
}

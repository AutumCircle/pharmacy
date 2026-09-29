import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { createStaffOrder } from '@/lib/api-v1/staff-server';
import { sendOrderNotification } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import type { CreateStaffOrderRequest } from '@/lib/api-v1/staff-types';

function isRequest(value: unknown): value is CreateStaffOrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = new Set(['customer_name', 'phone', 'address', 'landmark', 'source', 'items']);
  return Object.keys(body).every((key) => allowed.has(key))
    && (body.customer_name === undefined || typeof body.customer_name === 'string')
    && typeof body.phone === 'string' && /^\d{9}$/.test(body.phone)
    && typeof body.address === 'string' && typeof body.landmark === 'string'
    && ['instagram', 'whatsapp', 'phone'].includes(String(body.source))
    && Array.isArray(body.items) && body.items.length <= 50
    && body.items.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const fields = item as Record<string, unknown>;
      return Object.keys(fields).length === 2
        && Number.isInteger(fields.medicine_id) && Number(fields.medicine_id) > 0
        && Number.isInteger(fields.quantity) && Number(fields.quantity) >= 1 && Number(fields.quantity) <= 99;
    });
}

export async function POST(request: Request) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: 'Требуется вход' }, { status: 401 });
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) return NextResponse.json({ error: 'Повторите отправку' }, { status: 400 });
    const body: unknown = await request.json();
    if (!isRequest(body)) return NextResponse.json({ error: 'Проверьте обязательные поля' }, { status: 400 });
    const response = await createStaffOrder(token, body, idempotencyKey);
    const notification = response.data._notification;
    delete response.data._notification;
    let notificationSent = false;
    if (notification) {
      try {
        await sendOrderNotification(notification);
        notificationSent = true;
      } catch (error) {
        console.error('Staff order was created, but notification failed', error);
      }
    }
    return NextResponse.json({ ...response, data: { ...response.data, notification_sent: notificationSent } }, { status: 201 });
  } catch (error) {
    return apiRouteError(error);
  }
}

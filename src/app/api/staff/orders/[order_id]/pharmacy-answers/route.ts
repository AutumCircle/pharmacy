import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { answerPharmacyOrderItems } from '@/lib/api-v1/staff-server';
import { sendOrderNotification } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { sendChangeNotificationSafely, splitChangeNotification, validatePharmacyAnswersRequest } from '@/lib/pharmacy-answers';

// Pharmacist answers per item (job 010). Only pre-validates; Lambda takes the pharmacy id from the
// staff session, checks item ownership under an order lock and routes «Нет в наличии» to «Ватан 2».
// Job 013: when the answer changed a price or routed an item, Lambda adds `_notification` (owner and
// courier Telegram, no client data). It never reaches the browser. The notifier is called after the
// response is sent (`after()`), so the pharmacy never waits for Telegram; a failure is only logged.
export async function POST(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json().catch(() => null);
    const checked = validatePharmacyAnswersRequest(body);
    if (!checked.ok) return NextResponse.json({ error: { message: checked.error } }, { status: 400 });
    const response = await answerPharmacyOrderItems(token, order_id, checked.value);
    const { data, notification } = splitChangeNotification(response.data);
    if (notification) {
      after(() => sendChangeNotificationSafely(notification, sendOrderNotification,
        (error) => console.error('Pharmacy answer was saved, but the change notification failed', error)));
    }
    return NextResponse.json({ ...response, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

import { NextResponse } from 'next/server';
import { trackPublicOrders } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { parseTrackingPhone } from '@/lib/tracking-phone';

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { phone?: unknown }).phone !== 'string') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Введите ровно 9 цифр номера телефона.' } },
        { status: 400 },
      );
    }
    const parsedPhone = parseTrackingPhone((body as { phone: string }).phone);
    if (!parsedPhone.valid || !parsedPhone.normalized) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsedPhone.error || 'Введите ровно 9 цифр номера телефона.' } },
        { status: 400 },
      );
    }
    const response = await trackPublicOrders(parsedPhone.normalized);
    return NextResponse.json(response);
  } catch (error) {
    return apiRouteError(error);
  }
}

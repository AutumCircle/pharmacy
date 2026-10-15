import { NextResponse } from 'next/server';
import { trackPublicOrders } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { clientAddress, createFixedWindowLimiter } from '@/lib/rate-limit';
import { parseTrackingPhone } from '@/lib/tracking-phone';

// Per-client (IP) fixed-window limit on phone lookups. In-memory per Vercel instance;
// see API_CONTRACT.md §7 for scope and limitations.
const TRACKING_RATE_LIMIT = 10;
const TRACKING_RATE_WINDOW_MS = 10 * 60 * 1000;
const TRACKING_RATE_MAX_KEYS = 10_000;
const RATE_LIMITED_MESSAGE = 'Слишком много запросов. Повторите через несколько минут.';

const trackingLimiter = createFixedWindowLimiter({
  limit: TRACKING_RATE_LIMIT,
  windowMs: TRACKING_RATE_WINDOW_MS,
  maxKeys: TRACKING_RATE_MAX_KEYS,
});

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
    const decision = trackingLimiter.consume(clientAddress(request.headers), Date.now());
    if (!decision.allowed) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE } },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }
    const response = await trackPublicOrders(parsedPhone.normalized);
    return NextResponse.json(response);
  } catch (error) {
    return apiRouteError(error);
  }
}

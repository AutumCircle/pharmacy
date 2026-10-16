import { NextResponse } from 'next/server';
import { trackPublicOrders } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { clientAddress } from '@/lib/rate-limit';
import { parseTrackingPhone } from '@/lib/tracking-phone';
import {
  TRACKING_BLOCK_MS,
  TRACKING_MAX_KEYS,
  TRACKING_RATE_LIMIT,
  TRACKING_RATE_WINDOW_MS,
  TRACKING_SCRAPE_DISTINCT_PHONES,
  TRACKING_SCRAPE_WINDOW_MS,
  createTrackingGuard,
} from '@/lib/tracking-guard';

// Per-IP tracking guard, kept in memory per Vercel instance (not global, reset on cold start).
// Never log phones or phone digests.
const trackingGuard = createTrackingGuard({
  rateLimit: TRACKING_RATE_LIMIT,
  rateWindowMs: TRACKING_RATE_WINDOW_MS,
  scrapeDistinctPhones: TRACKING_SCRAPE_DISTINCT_PHONES,
  scrapeWindowMs: TRACKING_SCRAPE_WINDOW_MS,
  blockMs: TRACKING_BLOCK_MS,
  maxKeys: TRACKING_MAX_KEYS,
});

const GUARD_MESSAGES = {
  RATE_LIMITED: 'Слишком много запросов. Пожалуйста, повторите через минуту.',
  TRACKING_BLOCKED: 'Поиск заказов временно недоступен. Пожалуйста, попробуйте снова примерно через 5 часов.',
} as const;

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
    // Only valid lookups reach the guard; the key is the client IP, phones are stored as HMAC digests.
    const decision = trackingGuard.check(clientAddress(request.headers), parsedPhone.normalized, Date.now());
    if (!decision.allowed) {
      return NextResponse.json(
        { error: { code: decision.code, message: GUARD_MESSAGES[decision.code] } },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }
    const response = await trackPublicOrders(parsedPhone.normalized);
    return NextResponse.json(response);
  } catch (error) {
    return apiRouteError(error);
  }
}

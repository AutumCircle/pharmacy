import { cookies } from 'next/headers';
import { NextResponse, after } from 'next/server';
import { createPublicOrder, sendOrderNotification } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import type { CreateOrderRequest, OrderAttribution } from '@/lib/api-v1/types';
import { SOURCE_COOKIE, attributionForOrder, parseSource } from '@/lib/collections';
import { clientAddress, createFixedWindowLimiter } from '@/lib/rate-limit';

// Per-client (IP) limit on order attempts, kept in memory per Vercel instance.
// 5 attempts per 10 minutes covers one order + two idempotent retries + one correction
// (e.g. after ORDER_ITEMS_UNAVAILABLE) with headroom for carrier NAT. Must stay >= 3.
// Not a global limit: counters are per warm instance and reset on cold start.
const CHECKOUT_RATE_LIMIT = 5;
const CHECKOUT_RATE_WINDOW_MS = 10 * 60 * 1000;
const CHECKOUT_RATE_MAX_KEYS = 10_000;
const checkoutLimiter = createFixedWindowLimiter({
  limit: CHECKOUT_RATE_LIMIT,
  windowMs: CHECKOUT_RATE_WINDOW_MS,
  maxKeys: CHECKOUT_RATE_MAX_KEYS,
});
const RATE_LIMITED_MESSAGE = 'Слишком много попыток оформить заказ. Подождите несколько минут и попробуйте снова.';

function isCreateOrderRequest(value: unknown): value is CreateOrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = new Set(['customer_name', 'phone', 'address', 'landmark', 'payment_method', 'comment', 'items']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return false;
  if (typeof body.customer_name !== 'string' || typeof body.phone !== 'string' || typeof body.address !== 'string') return false;
  if (body.landmark !== undefined && body.landmark !== null && typeof body.landmark !== 'string') return false;
  if (body.payment_method !== undefined && body.payment_method !== 'cash_on_delivery' && body.payment_method !== 'e_wallet') return false;
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string') return false;
  if (!Array.isArray(body.items) || body.items.length === 0) return false;
  return body.items.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const fields = item as Record<string, unknown>;
    return Object.keys(fields).every((key) => key === 'medicine_id' || key === 'quantity')
      && Number.isInteger(fields.medicine_id)
      && typeof fields.quantity === 'number' && Number.isFinite(fields.quantity)
      && fields.quantity >= 0.5 && fields.quantity <= 99 && Number.isInteger(fields.quantity * 2);
  });
}

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key is required' } },
        { status: 400 },
      );
    }
    const body: unknown = await request.json();
    if (!isCreateOrderRequest(body)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid order request' } },
        { status: 400 },
      );
    }
    // Only well-formed attempts use quota; the key is the client IP only (never phone/name/address).
    const decision = checkoutLimiter.consume(clientAddress(request.headers), Date.now());
    if (!decision.allowed) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE } },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }
    // Attribution is taken from the latest tracked-link cookie; the browser body cannot set it.
    const attribution = attributionForOrder(parseSource((await cookies()).get(SOURCE_COOKIE)?.value));
    const response = await createPublicOrder(
      attribution ? { ...body, attribution: attribution as OrderAttribution } : body,
      idempotencyKey,
    );
    const order = response.data as typeof response.data & { _notification?: Record<string, unknown> };
    const notification = order._notification;
    if (notification) {
      delete order._notification;
      // Telegram is sent after the response, so the customer sees «Заказ принят» without waiting for
      // three messages. A failure is only logged: the order already exists.
      after(async () => {
        try {
          await sendOrderNotification(notification);
        } catch (notificationError) {
          console.error('Order was created, but Telegram notification failed', notificationError);
        }
      });
    }
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return apiRouteError(error);
  }
}

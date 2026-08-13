import { NextResponse } from 'next/server';
import { createPublicOrder } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import type { CreateOrderRequest } from '@/lib/api-v1/types';

function isCreateOrderRequest(value: unknown): value is CreateOrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = new Set(['customer_name', 'phone', 'address', 'comment', 'items']);
  if (Object.keys(body).some((key) => !allowed.has(key))) return false;
  if (typeof body.customer_name !== 'string' || typeof body.phone !== 'string' || typeof body.address !== 'string') return false;
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== 'string') return false;
  if (!Array.isArray(body.items) || body.items.length === 0) return false;
  return body.items.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const fields = item as Record<string, unknown>;
    return Object.keys(fields).every((key) => key === 'medicine_id' || key === 'quantity')
      && Number.isInteger(fields.medicine_id)
      && Number.isInteger(fields.quantity);
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
    const response = await createPublicOrder(body, idempotencyKey);
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return apiRouteError(error);
  }
}

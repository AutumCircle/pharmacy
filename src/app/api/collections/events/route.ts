import { NextResponse } from 'next/server';
import { recordPublicCollectionEvent } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { isBotUserAgent } from '@/lib/collections';

const FIELDS = [
  'collection_slug', 'event_type', 'product_id', 'visitor_id', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
] as const;

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const userAgent = request.headers.get('user-agent') ?? '';
  // Preview crawlers are dropped here; the Lambda filters again as a second line of defence.
  if (isBotUserAgent(userAgent)) return NextResponse.json({ data: { recorded: false } }, { status: 202 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid event' } }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid event' } }, { status: 400 });
  }
  const source = body as Record<string, unknown>;
  const event: Record<string, unknown> = { user_agent: userAgent.slice(0, 300) };
  for (const field of FIELDS) {
    if (source[field] !== undefined && source[field] !== null) event[field] = source[field];
  }
  try {
    const response = await recordPublicCollectionEvent(event);
    return NextResponse.json({ data: response.data }, { status: 202 });
  } catch (error) {
    return apiRouteError(error);
  }
}

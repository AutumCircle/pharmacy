import { NextResponse } from 'next/server';

import { getPublicProductCarousels } from '@/lib/api-v1/server';
import { toPublicCarouselsPayload } from '@/lib/public-carousels';

// Public, anonymous, read-only JSON for the iOS app: same carousels as the homepage.
// The API key stays server-side inside getPublicProductCarousels(); the fetch data cache there
// revalidates every 60 s, and the CDN caches the response for 60 s as well.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await getPublicProductCarousels();
    return NextResponse.json(toPublicCarouselsPayload(response.data.carousels), {
      status: 200,
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'CAROUSELS_UNAVAILABLE', message: 'Секции товаров временно недоступны.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
    );
  }
}

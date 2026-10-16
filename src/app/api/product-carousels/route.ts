import { NextResponse } from 'next/server';

import { getPublicFeaturedProducts, getPublicProductCarousels } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

// Public, read-only: homepage product carousels for the iOS app, with the same
// legacy «Товары дня» fallback as the home page (src/app/page.tsx).
export async function GET() {
  const headers = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };
  try {
    return NextResponse.json(await getPublicProductCarousels(), { headers });
  } catch (error) {
    const legacy = await getPublicFeaturedProducts().catch(() => null);
    if (!legacy) return apiRouteError(error);
    return NextResponse.json({
      data: { carousels: [{ slug: 'items-of-the-day', title: 'Товары дня', sort_order: 10, products: legacy.data.products }] },
      request_id: legacy.request_id,
    }, { headers });
  }
}

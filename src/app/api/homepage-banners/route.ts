import { NextResponse } from 'next/server';

import { getPublicHomepageBanners } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

// Public, read-only: active homepage banners for the iOS app (the website renders them server-side).
export async function GET() {
  try {
    return NextResponse.json(await getPublicHomepageBanners(), {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    return apiRouteError(error);
  }
}

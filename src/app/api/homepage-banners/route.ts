import { NextResponse } from 'next/server';

import { getPublicHomepageBanners } from '@/lib/api-v1/server';
import { toPublicBannersPayload } from '@/lib/public-banners';

// Native clients get the same active banners as the homepage; credentials remain server-side.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await getPublicHomepageBanners();
    return NextResponse.json(toPublicBannersPayload(response.data.banners), {
      status: 200,
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'BANNERS_UNAVAILABLE', message: 'Баннеры временно недоступны.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
    );
  }
}

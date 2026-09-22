import { NextResponse } from 'next/server';
import { getPublicSiteSettings } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await getPublicSiteSettings();
    return NextResponse.json(response.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

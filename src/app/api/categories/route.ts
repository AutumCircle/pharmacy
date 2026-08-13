import { NextResponse } from 'next/server';

import { getPublicCategories } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);
  try {
    return NextResponse.json(await getPublicCategories(limit, searchParams.get('cursor') || undefined));
  } catch (error) {
    return apiRouteError(error);
  }
}

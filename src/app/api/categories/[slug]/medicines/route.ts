import { NextResponse } from 'next/server';

import { getPublicCategoryMedicines } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const searchParams = new URL(request.url).searchParams;
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);
  try {
    return NextResponse.json(
      await getPublicCategoryMedicines(slug, limit, searchParams.get('cursor') || undefined),
    );
  } catch (error) {
    return apiRouteError(error);
  }
}

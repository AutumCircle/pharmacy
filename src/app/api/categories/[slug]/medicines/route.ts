import { NextResponse } from 'next/server';

import { getPublicCategoryMedicines } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const searchParams = new URL(request.url).searchParams;
  const rawLimit = Number(searchParams.get('limit'));
  const rawPage = Number(searchParams.get('page'));
  const limit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 100) : 24;
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, 100_000) : 1;
  try {
    return NextResponse.json(
      await getPublicCategoryMedicines(slug, page, limit),
    );
  } catch (error) {
    return apiRouteError(error);
  }
}

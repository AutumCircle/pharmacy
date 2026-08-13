import { NextResponse } from 'next/server';
import { searchPublicMedicines } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ data: [], page: { next_cursor: null, has_more: false }, request_id: 'local_validation' });
  }

  try {
    const limit = Math.min(Number(searchParams.get('limit')) || 10, 100);
    const cursor = searchParams.get('cursor') || undefined;
    const response = await searchPublicMedicines(q.trim(), limit, cursor);
    return NextResponse.json(response);
  } catch (error) {
    return apiRouteError(error);
  }
}

import { NextResponse } from 'next/server';

import { getPublicMedicine } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ medicine_id: string }> },
) {
  const { medicine_id: rawId } = await params;
  const medicineId = Number(rawId);
  if (!Number.isInteger(medicineId) || medicineId <= 0) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Medicine ID must be a positive integer' } },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getPublicMedicine(medicineId));
  } catch (error) {
    return apiRouteError(error);
  }
}

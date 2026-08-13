import { NextResponse } from 'next/server';

import { resolvePublicMedicines } from '@/lib/api-v1/server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request' } }, { status: 400 });
    }
    const medicineIds = (body as Record<string, unknown>).medicine_ids;
    if (!Array.isArray(medicineIds) || !medicineIds.length || medicineIds.length > 50
      || medicineIds.some((value) => !Number.isInteger(value) || Number(value) <= 0)
      || new Set(medicineIds).size !== medicineIds.length) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'medicine_ids is invalid' } }, { status: 400 });
    }
    return NextResponse.json(await resolvePublicMedicines(medicineIds as number[]));
  } catch (error) {
    return apiRouteError(error);
  }
}

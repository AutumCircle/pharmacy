import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminMedicineVisibility } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Owner's «Нет в наличии»: `{ hidden_from_clients: true }` hides the medicine from clients, `false` returns it. */
export async function PATCH(request: Request, context: { params: Promise<{ medicine_id: string }> }) {
  try {
    await requireAdminSession();
    const { medicine_id } = await context.params;
    const medicineId = Number(medicine_id);
    const body: unknown = await request.json().catch(() => null);
    if (!Number.isInteger(medicineId) || medicineId <= 0 || !body || typeof body !== 'object'
      || !('hidden_from_clients' in body) || typeof body.hidden_from_clients !== 'boolean') {
      return NextResponse.json({ error: 'Неверные данные' }, { status: 400 });
    }
    const response = await updateAdminMedicineVisibility(medicineId, body.hidden_from_clients);
    return NextResponse.json(response.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof ApiV1Error ? error.status : 500;
    return NextResponse.json({ error: 'Не удалось сохранить' }, { status });
  }
}

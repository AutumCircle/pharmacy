import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateAdminMedicineImage } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ medicine_id: string }> }) {
  try {
    await requireAdminSession();
    const { medicine_id } = await context.params;
    const medicineId = Number(medicine_id);
    const body: unknown = await request.json();
    if (!Number.isInteger(medicineId) || medicineId <= 0 || !body || typeof body !== 'object'
      || !('image_url' in body) || (body.image_url !== null && typeof body.image_url !== 'string')) {
      return NextResponse.json({ error: 'Неверные данные изображения' }, { status: 400 });
    }
    const response = await updateAdminMedicineImage(medicineId, body.image_url);
    return NextResponse.json(response.data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof ApiV1Error ? error.status : 500;
    return NextResponse.json({ error: 'Не удалось сохранить изображение' }, { status });
  }
}

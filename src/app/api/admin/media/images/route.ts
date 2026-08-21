import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import { uploadAdminMediaImage } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    await requireAdminSession();
    const form = await request.formData();
    const file = form.get('file');
    const scope = form.get('scope');
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Используйте JPEG, PNG или WebP размером не более 3 МБ' }, { status: 400 });
    }
    if (scope !== 'banners' && scope !== 'products') {
      return NextResponse.json({ error: 'Неверный тип изображения' }, { status: 400 });
    }
    const data_base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const response = await uploadAdminMediaImage({
      content_type: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      data_base64,
      scope,
    });
    return NextResponse.json(response.data, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof ApiV1Error
      ? error.status
      : error instanceof Error && error.message === 'ADMIN_SESSION_REQUIRED'
        ? 401
        : 500;
    const message = error instanceof Error ? error.message : 'Не удалось загрузить изображение';
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/admin-auth';
import { updateStaffAccount } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ account_id: string }> }) {
  try {
    await requireAdminSession();
    const { account_id: rawAccountId } = await context.params;
    const accountId = Number(rawAccountId);
    const body: unknown = await request.json();
    if (![1, 2, 3].includes(accountId) || !body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: { message: 'Некорректные данные' } }, { status: 400 });
    }
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).some((key) => key !== 'username' && key !== 'password')
      || typeof fields.username !== 'string'
      || (fields.password !== undefined && typeof fields.password !== 'string')) {
      return NextResponse.json({ error: { message: 'Некорректные данные' } }, { status: 400 });
    }
    const result = await updateStaffAccount(accountId, {
      username: fields.username,
      ...(typeof fields.password === 'string' && fields.password ? { password: fields.password } : {}),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_SESSION_REQUIRED') {
      return NextResponse.json({ error: { message: 'Войдите в админ-панель снова' } }, { status: 401 });
    }
    if (error instanceof ApiV1Error) {
      const message = error.status === 409 ? 'Этот логин уже используется' : error.message;
      return NextResponse.json({ error: { code: error.code, message } }, { status: error.status });
    }
    return NextResponse.json({ error: { message: 'Не удалось сохранить изменения' } }, { status: 500 });
  }
}

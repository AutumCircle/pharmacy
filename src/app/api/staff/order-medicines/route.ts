import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { searchStaffOrderMedicines } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const query = new URL(request.url).searchParams.get('q')?.trim() || '';
    if (query.length < 2 || query.length > 120) {
      return NextResponse.json({ error: { message: 'Введите минимум 2 символа' } }, { status: 400 });
    }
    const result = await searchStaffOrderMedicines(token, query);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

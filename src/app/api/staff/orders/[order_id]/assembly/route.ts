import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { markPharmacyAssembly } from '@/lib/api-v1/staff-server';
import { apiRouteError } from '@/lib/api-v1/route-response';
import { validateAssemblyRequest } from '@/lib/pharmacy-assembly';

// «Начать сборку» / «Собран» (job 011). Only pre-validates; Lambda takes the pharmacy id from the
// staff session, checks the order status and this pharmacy's items under an order lock.
export async function POST(request: Request, { params }: { params: Promise<{ order_id: string }> }) {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: { message: 'Требуется вход' } }, { status: 401 });
    const { order_id } = await params;
    if (!/^ord_[0-9a-f]{32}$|^legacy_[1-9][0-9]*$/.test(order_id)) {
      return NextResponse.json({ error: { message: 'Неверный номер заказа' } }, { status: 400 });
    }
    const body: unknown = await request.json().catch(() => null);
    const checked = validateAssemblyRequest(body);
    if (!checked.ok) return NextResponse.json({ error: { message: checked.error } }, { status: 400 });
    const response = await markPharmacyAssembly(token, order_id, checked.value);
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiRouteError(error);
  }
}

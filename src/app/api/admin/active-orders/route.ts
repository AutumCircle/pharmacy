import { NextResponse } from 'next/server';
import { fetchAdminData } from '../../../../lib/api';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  if (!cookieStore.get('vatan_admin_session')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await fetchAdminData('list_orders');
    const orders = data?.orders || [];
    const activeCount = orders.filter((o: any) => o.status !== 'delivered' && o.status !== 'cancelled').length;
    return NextResponse.json({ activeCount });
  } catch (error) {
    return NextResponse.json({ activeCount: 0 });
  }
}

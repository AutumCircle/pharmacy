import { notFound, redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';
import { getCourierOrder } from '@/lib/api-v1/staff-server';
import { ApiV1Error } from '@/lib/api-v1/server';
import CourierOrderDetail from './CourierOrderDetail';
import LiveRefresh from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

export default async function CourierOrderPage({ params }: { params: Promise<{ order_id: string }> }) {
  const { account, token } = await requireStaffSession();
  if (account.role !== 'courier') redirect('/staff/orders');
  const { order_id } = await params;
  if (!/^(?:ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)$/.test(order_id)) notFound();
  const response = await getCourierOrder(token, order_id).catch((error: unknown) => {
    if (error instanceof ApiV1Error && error.status === 404) notFound();
    throw error;
  });
  return <><LiveRefresh /><CourierOrderDetail key={order_id} order={response.data} /></>;
}

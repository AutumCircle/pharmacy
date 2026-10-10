import { requireStaffSession } from '@/lib/staff-auth';
import { redirect } from 'next/navigation';
import StaffOrderForm from './StaffOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewStaffOrderPage() {
  const { account } = await requireStaffSession();
  if (account.role !== 'courier') redirect('/staff/orders');
  return <StaffOrderForm accountId={account.account_id} username={account.username} />;
}

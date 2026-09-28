import { requireStaffSession } from '@/lib/staff-auth';
import StaffOrderForm from './StaffOrderForm';

export const dynamic = 'force-dynamic';

export default async function NewStaffOrderPage() {
  const { account } = await requireStaffSession();
  return <StaffOrderForm accountId={account.account_id} username={account.username} />;
}

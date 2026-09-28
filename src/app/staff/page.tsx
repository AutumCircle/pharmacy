import { redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';

export default async function StaffPage() {
  const { account } = await requireStaffSession();
  redirect(account.catalog_access ? '/staff/medicines' : '/staff/no-access');
}

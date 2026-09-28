import { redirect } from 'next/navigation';
import { requireStaffSession } from '@/lib/staff-auth';

export default async function StaffPage() {
  await requireStaffSession();
  redirect('/staff/orders/new');
}

import StaffShell from './StaffShell';
import './staff.css';
import { cookies } from 'next/headers';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';
import { getStaffSession } from '@/lib/api-v1/staff-server';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  const account = token ? await getStaffSession(token).catch(() => null) : null;
  return <StaffShell role={account?.role ?? null}>{children}</StaffShell>;
}

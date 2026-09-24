import 'server-only';

import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyStaffSession } from './admin-session';

export async function requireStaffSession(): Promise<void> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!secret || !(await verifyStaffSession(token, secret))) {
    throw new Error('STAFF_SESSION_REQUIRED');
  }
}

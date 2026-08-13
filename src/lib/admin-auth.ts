import 'server-only';

import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from './admin-session';

export async function requireAdminSession(): Promise<void> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!secret || !(await verifyAdminSession(token, secret))) {
    throw new Error('ADMIN_SESSION_REQUIRED');
  }
}

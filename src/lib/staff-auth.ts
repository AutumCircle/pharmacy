import 'server-only';

import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyStaffSession } from './admin-session';
import { getStaffSession } from './api-v1/staff-server';
import { ApiV1Error } from './api-v1/server';
import { redirect } from 'next/navigation';

export async function requireStaffSession(catalog = false) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!secret || !(await verifyStaffSession(token, secret))) {
    redirect('/staff/login');
  }
  if (!token) redirect('/staff/login');
  let account;
  try {
    account = await getStaffSession(token);
  } catch (error) {
    if (error instanceof ApiV1Error && error.status === 401) redirect('/staff/login');
    throw error;
  }
  if (catalog && !account.catalog_access) redirect('/staff/no-access');
  return { account, token };
}

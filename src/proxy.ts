import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin/login') return NextResponse.next();

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!secret || !(await verifyAdminSession(token, secret))) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};

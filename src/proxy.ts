import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ADMIN_SESSION_COOKIE, readSessionRole } from '@/lib/admin-session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin/login' || pathname === '/staff/login') return NextResponse.next();

  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const role = secret ? await readSessionRole(token, secret) : null;
  const requiredRole = pathname.startsWith('/admin') ? 'admin' : 'staff';
  if (role !== requiredRole) {
    const url = request.nextUrl.clone();
    url.pathname = role === 'admin' ? '/admin' : role === 'staff' ? '/staff/medicines' : `/${requiredRole}/login`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/staff/:path*'],
};

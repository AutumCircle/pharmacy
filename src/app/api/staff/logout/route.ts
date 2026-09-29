import { NextResponse } from 'next/server';
import { STAFF_SESSION_COOKIE } from '@/lib/admin-session';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(STAFF_SESSION_COOKIE);
  return response;
}

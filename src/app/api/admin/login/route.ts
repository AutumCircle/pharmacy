import { NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  createAdminSession,
  secretsEqual,
} from '@/lib/admin-session';

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientAddress(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || null;
}

export async function POST(req: Request) {
  try {
    const address = clientAddress(req);
    const now = Date.now();
    const currentAttempt = address ? attempts.get(address) : undefined;
    if (currentAttempt && currentAttempt.resetAt > now && currentAttempt.count >= MAX_ATTEMPTS) {
      return NextResponse.json({ error: 'Слишком много попыток. Повторите через 15 минут.' }, { status: 429 });
    }
    const body: unknown = await req.json();
    const credentials = typeof body === 'object' && body !== null
      ? body as { username?: unknown; password?: unknown }
      : {};
    const username = credentials.username;
    const password = credentials.password;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const sessionSecret = process.env.ADMIN_SESSION_SECRET;
    if (!adminUsername || !adminPassword || !sessionSecret) {
      return NextResponse.json({ error: 'Admin authentication is not configured' }, { status: 503 });
    }

    const [usernameValid, passwordValid] = await Promise.all([
      secretsEqual(typeof username === 'string' ? username : '', adminUsername),
      secretsEqual(typeof password === 'string' ? password : '', adminPassword),
    ]);
    const valid = usernameValid && passwordValid;
    if (valid) {
      if (address) attempts.delete(address);
      const response = NextResponse.json({ success: true });
      const forwardedProtocol = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const requestIsHttps = forwardedProtocol
        ? forwardedProtocol === 'https'
        : new URL(req.url).protocol === 'https:';
      response.cookies.set(ADMIN_SESSION_COOKIE, await createAdminSession(sessionSecret), {
        httpOnly: true,
        secure: requestIsHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: ADMIN_SESSION_SECONDS,
      });
      return response;
    } else {
      if (address) {
        const active = currentAttempt && currentAttempt.resetAt > now
          ? currentAttempt
          : { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
        attempts.set(address, { ...active, count: active.count + 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

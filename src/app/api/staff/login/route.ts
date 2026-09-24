import { NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  createStaffSession,
  deriveStaffPassword,
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

export async function POST(request: Request) {
  try {
    const address = clientAddress(request);
    const now = Date.now();
    const currentAttempt = address ? attempts.get(address) : undefined;
    if (currentAttempt && currentAttempt.resetAt > now && currentAttempt.count >= MAX_ATTEMPTS) {
      return NextResponse.json({ error: 'Слишком много попыток. Повторите через 15 минут.' }, { status: 429 });
    }

    const body: unknown = await request.json();
    const credentials = typeof body === 'object' && body !== null
      ? body as { username?: unknown; password?: unknown }
      : {};
    const sessionSecret = process.env.ADMIN_SESSION_SECRET;
    if (!sessionSecret) {
      return NextResponse.json({ error: 'Авторизация сотрудников не настроена' }, { status: 503 });
    }

    const staffUsername = process.env.STAFF_USERNAME || 'pharmacy_staff';
    const staffPassword = process.env.STAFF_PASSWORD || await deriveStaffPassword(sessionSecret);
    const [usernameValid, passwordValid] = await Promise.all([
      secretsEqual(typeof credentials.username === 'string' ? credentials.username : '', staffUsername),
      secretsEqual(typeof credentials.password === 'string' ? credentials.password : '', staffPassword),
    ]);

    if (usernameValid && passwordValid) {
      if (address) attempts.delete(address);
      const response = NextResponse.json({ success: true });
      const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const requestIsHttps = forwardedProtocol
        ? forwardedProtocol === 'https'
        : new URL(request.url).protocol === 'https:';
      response.cookies.set(ADMIN_SESSION_COOKIE, await createStaffSession(sessionSecret), {
        httpOnly: true,
        secure: requestIsHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: ADMIN_SESSION_SECONDS,
      });
      return response;
    }

    if (address) {
      const active = currentAttempt && currentAttempt.resetAt > now
        ? currentAttempt
        : { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
      attempts.set(address, { ...active, count: active.count + 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}

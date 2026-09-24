const encoder = new TextEncoder();

export const ADMIN_SESSION_COOKIE = 'vatan_admin_session';
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export type SessionRole = 'admin' | 'staff';

type SessionPayload = {
  role: SessionRole;
  expiresAt: number;
};

function encode(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters');
  }
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function createSession(secret: string, role: SessionRole): Promise<string> {
  const payload: SessionPayload = {
    role,
    expiresAt: Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(encodedPayload));
  return `${encodedPayload}.${encode(new Uint8Array(signature))}`;
}

export function createAdminSession(secret: string): Promise<string> {
  return createSession(secret, 'admin');
}

export function createStaffSession(secret: string): Promise<string> {
  return createSession(secret, 'staff');
}

export async function readSessionRole(token: string | undefined, secret: string): Promise<SessionRole | null> {
  if (!token) return null;
  const [payloadPart, signaturePart, extra] = token.split('.');
  if (!payloadPart || !signaturePart || extra) return null;
  try {
    const signatureBytes = Uint8Array.from(decode(signaturePart), (character) => character.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC', await signingKey(secret), signatureBytes, encoder.encode(payloadPart),
    );
    if (!valid) return null;
    const payload = JSON.parse(decode(payloadPart)) as Partial<SessionPayload>;
    const role = payload.role;
    return (role === 'admin' || role === 'staff')
      && typeof payload.expiresAt === 'number'
      && payload.expiresAt > Math.floor(Date.now() / 1000)
      ? role
      : null;
  } catch {
    return null;
  }
}

export async function verifyAdminSession(token: string | undefined, secret: string): Promise<boolean> {
  return (await readSessionRole(token, secret)) === 'admin';
}

export async function verifyStaffSession(token: string | undefined, secret: string): Promise<boolean> {
  return (await readSessionRole(token, secret)) === 'staff';
}

export async function deriveStaffPassword(secret: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC', await signingKey(secret), encoder.encode('vatan-pharmacy-staff-password-v1'),
  );
  return `Vt-${encode(new Uint8Array(signature)).slice(0, 28)}!7`;
}

export async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = (await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])).map((value) => new Uint8Array(value));
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index];
  }
  return difference === 0;
}

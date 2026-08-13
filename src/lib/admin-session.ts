const encoder = new TextEncoder();

export const ADMIN_SESSION_COOKIE = 'vatan_admin_session';
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

type SessionPayload = {
  role: 'admin';
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

export async function createAdminSession(secret: string): Promise<string> {
  const payload: SessionPayload = {
    role: 'admin',
    expiresAt: Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(encodedPayload));
  return `${encodedPayload}.${encode(new Uint8Array(signature))}`;
}

export async function verifyAdminSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [payloadPart, signaturePart, extra] = token.split('.');
  if (!payloadPart || !signaturePart || extra) return false;
  try {
    const signatureBytes = Uint8Array.from(decode(signaturePart), (character) => character.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC', await signingKey(secret), signatureBytes, encoder.encode(payloadPart),
    );
    if (!valid) return false;
    const payload = JSON.parse(decode(payloadPart)) as Partial<SessionPayload>;
    return payload.role === 'admin'
      && typeof payload.expiresAt === 'number'
      && payload.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
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

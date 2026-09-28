import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createAdminSession, readSessionRole, verifyAdminSession, verifyStaffSession } from '../src/lib/admin-session.ts';

const secret = 'test-session-signing-secret-only-123456';
function lambdaToken(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

test('Lambda employee session is accepted only as staff, never admin', async () => {
  const token = lambdaToken({ role: 'staff', accountId: 2, credentialVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 100 });
  assert.equal(await verifyStaffSession(token, secret), true);
  assert.equal(await verifyAdminSession(token, secret), false);
  assert.equal(await verifyStaffSession(await createAdminSession(secret), secret), false);
});

test('expired and modified signatures cannot pass the proxy role check', async () => {
  assert.equal(await readSessionRole(lambdaToken({ role: 'staff', expiresAt: 1 }), secret), null);
  const token = lambdaToken({ role: 'staff', expiresAt: Math.floor(Date.now() / 1000) + 100 });
  assert.equal(await readSessionRole(token + 'x', secret), null);
});

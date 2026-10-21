import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { getOutbox } from '../src/platform/email/mailer.js';
import { app, authHeader, loginAs, loginAsNewOwner, signupOrganization } from './helpers.js';

function lastLinkTo(email: string, path: string): string {
  const message = [...getOutbox()].reverse().find((m) => m.to === email && m.text.includes(path));
  if (!message) throw new Error(`no email to ${email} containing ${path}`);
  const match = message.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error('no token in email');
  return match[1];
}

describe('account lifecycle', () => {
  it('signup sends a verification email; the link verifies once and only once', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization('Verify');
    const token = await loginAs(ownerEmail, ownerPassword);

    const before = await request(app).get('/api/v1/auth/me').set(...authHeader(token));
    expect(before.status).toBe(200);
    expect(before.body.user.emailVerifiedAt).toBeNull();
    expect(before.body.user).not.toHaveProperty('passwordHash');

    const verifyToken = lastLinkTo(ownerEmail, '/verify-email');
    const ok = await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken });
    expect(ok.status).toBe(200);

    const after = await request(app).get('/api/v1/auth/me').set(...authHeader(token));
    expect(after.body.user.emailVerifiedAt).not.toBeNull();

    const again = await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken });
    expect(again.status).toBe(400);
  });

  it('stores only a hash of the emailed token', async () => {
    const { ownerEmail } = await signupOrganization('Hash');
    const raw = lastLinkTo(ownerEmail, '/verify-email');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const rows = await prisma.authToken.findMany({ where: { userId: user.id } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.tokenHash).not.toBe(raw);
  });

  it('forgot-password answers identically for unknown emails', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody-here@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('password reset: new password works, old one and old sessions do not, link is single-use', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization('Reset');
    const oldAccess = await loginAs(ownerEmail, ownerPassword);

    expect((await request(app).post('/api/v1/auth/forgot-password').send({ email: ownerEmail.toUpperCase() })).status).toBe(200);
    const resetToken = lastLinkTo(ownerEmail, '/reset-password');

    const weak = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('validation_error');

    const done = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'brand-new-pass-42' });
    expect(done.status).toBe(200);

    expect((await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'brand-new-pass-42' })).status).toBe(200);

    // Access tokens minted before the reset are revoked (watermark).
    const stale = await request(app).get('/api/v1/auth/me').set(...authHeader(oldAccess));
    expect(stale.status).toBe(401);

    const reuse = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'another-pass-99' });
    expect(reuse.status).toBe(400);
  });

  it('delete account requires the password + DELETE and removes the whole org for the sole owner', async () => {
    const { token, organizationId, ownerPassword } = await loginAsNewOwner('Delete Me');
    await request(app).post('/api/v1/properties').set(...authHeader(token)).send({ name: 'Doomed Inn', slug: 'doomed-inn' });

    const noConfirm = await request(app).delete('/api/v1/auth/account').set(...authHeader(token)).send({ password: ownerPassword });
    expect(noConfirm.status).toBe(400);

    const wrong = await request(app)
      .delete('/api/v1/auth/account')
      .set(...authHeader(token))
      .send({ password: 'not-it', confirm: 'DELETE' });
    expect(wrong.status).toBe(401);

    const ok = await request(app)
      .delete('/api/v1/auth/account')
      .set(...authHeader(token))
      .send({ password: ownerPassword, confirm: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(ok.body.deletedOrganization).toBe(true);

    expect(await prisma.organization.findUnique({ where: { id: organizationId } })).toBeNull();
    expect(await prisma.property.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.user.count({ where: { organizationId } })).toBe(0);
  });

  it('rejects a weak signup password with a clear message', async () => {
    const res = await request(app)
      .post('/api/v1/organizations')
      .send({
        organizationName: 'Weak Pw Hotel',
        organizationSlug: 'weak-pw-hotel',
        owner: { email: 'weak@example.com', password: 'abcdefgh', firstName: 'A', lastName: 'B' },
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.issues)).toContain('number');
  });
});

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('answers malformed JSON with a 400, not a 500', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });
});

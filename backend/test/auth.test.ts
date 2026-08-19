import argon2 from 'argon2';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, signupOrganization } from './helpers.js';

describe('POST /api/v1/auth/login', () => {
  it('returns an access token and sets a refresh cookie for valid credentials', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();

    const res = await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.email).toBe(ownerEmail);
    expect(res.headers['set-cookie']?.[0]).toContain('living_canvas_refresh=');
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rejects a wrong password with 401 and no user-existence hint', async () => {
    const { ownerEmail } = await signupOrganization();

    const res = await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'totally-wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects an unknown email with the same message as a wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password.');
  });

  it('performs an argon2id verification even for a nonexistent email (timing side-channel fix)', async () => {
    const spy = vi.spyOn(argon2, 'verify');
    spy.mockClear();

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'definitely-does-not-exist@example.com', password: 'whatever123' });

    // Proves the structural fix — verifyPassword is no longer skipped by
    // short-circuit evaluation when the account doesn't exist, which is
    // what previously made "no such user" distinguishable from "wrong
    // password" by response time alone.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a malformed body with 400 validation details', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rate-limits repeated attempts for the same email', async () => {
    const email = `rate-limit-${Date.now()}@example.com`;
    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('POST /api/v1/auth/refresh + /logout', () => {
  it('rotates the refresh session and issues a new access token', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const agent = request.agent(app);

    const login = await agent.post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });
    const firstRefreshCookie = login.headers['set-cookie']?.[0] as string;

    const refreshed = await agent.post('/api/v1/auth/refresh').send();
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe('string');
    // The access token itself can legitimately be byte-identical to the
    // previous one (same claims, same JWT `iat` second) — what refresh
    // must actually change is the underlying session: a fresh refresh
    // cookie value, and the old one no longer working (covered by the
    // replay-detection test below).
    expect(refreshed.headers['set-cookie']?.[0]).not.toBe(firstRefreshCookie);
  });

  it('rejects a refresh with no cookie present', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send();
    expect(res.status).toBe(401);
  });

  it('revokes the session on logout so it can no longer be refreshed', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });

    const logout = await agent.post('/api/v1/auth/logout').send();
    expect(logout.status).toBe(204);

    const refreshAfterLogout = await agent.post('/api/v1/auth/refresh').send();
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('rejects reusing an already-rotated refresh token (replay detection)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });
    const originalCookie = login.headers['set-cookie']?.[0] as string;

    // First refresh rotates the session (agent's cookie jar now holds the new token).
    await agent.post('/api/v1/auth/refresh').send();

    // Replaying the ORIGINAL (now-revoked) refresh token must fail.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', originalCookie).send();
    expect(replay.status).toBe(401);
  });

  it('rejects a refresh once the user has been deactivated, and revokes the session (the fix)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });

    // No staff-deactivation endpoint exists yet (Phase 1 scope) — this is
    // exactly the scenario the schema/mechanism exists to support once
    // one does, so the test provisions it directly, same pattern already
    // used in tenant-isolation.test.ts for PropertyAccess.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const refreshed = await agent.post('/api/v1/auth/refresh').send();
    expect(refreshed.status).toBe(401);

    // The session was revoked as part of discovering the deactivation —
    // not just this one attempt rejected, so retrying doesn't keep
    // hitting the same live-but-now-inactive-user check indefinitely.
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedAt).not.toBeNull();

    // A second refresh attempt with the same (now-revoked) cookie fails
    // the same way a replayed token does.
    const secondAttempt = await agent.post('/api/v1/auth/refresh').send();
    expect(secondAttempt.status).toBe(401);
  });

  it('still lets an active user refresh normally (no regression for the common case)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });

    const refreshed = await agent.post('/api/v1/auth/refresh').send();
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe('string');
  });
});

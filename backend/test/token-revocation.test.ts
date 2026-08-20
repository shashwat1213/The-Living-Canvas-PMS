/**
 * Coverage for the token-revocation watermark (User.tokensValidAfter —
 * see DECISIONS.md, "token-revocation watermark"). This is the piece
 * that closes the gap fix #1 (session/refresh revocation) couldn't: an
 * access token minted before a user was deactivated, and not yet
 * expired, is now rejected by `authenticate` too — bounded by the
 * revocation-cache TTL rather than the access token's own (longer) TTL.
 */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { bumpTokensValidAfter, deactivateUser } from '../src/platform/auth/revocation.js';
import { resolveAuthContext } from '../src/platform/auth/session-service.js';
import { app, authHeader, signupOrganization } from './helpers.js';

const PROTECTED_ROUTE = '/api/v1/organizations/me';

async function loginAndGetUser(ownerEmail: string, ownerPassword: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  return { accessToken: res.body.accessToken as string, user };
}

describe('token-revocation watermark', () => {
  it('rejects an already-issued access token immediately after bumpTokensValidAfter (proactive cache eviction)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const { accessToken, user } = await loginAndGetUser(ownerEmail, ownerPassword);

    const before = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(accessToken));
    expect(before.status).toBe(200);

    await bumpTokensValidAfter(user.id);

    // No wait — proves the eviction is proactive, not just "eventually
    // correct once the cache TTL expires" (covered separately below).
    const after = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(accessToken));
    expect(after.status).toBe(401);
  });

  it('accepts a token minted after the bump, even within the same wall-clock second', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const { user } = await loginAndGetUser(ownerEmail, ownerPassword);

    await bumpTokensValidAfter(user.id);

    // No wait. This used to need one: the watermark is a millisecond
    // timestamp but JWT's `iat` is whole seconds, so a login landing in
    // the same second as the bump truncated to an `iat` that looked
    // earlier than the bump and was spuriously rejected. `signAccessToken`
    // now records `iatMs` at the watermark's own precision, so a token
    // minted after a revocation is accepted immediately — which is what
    // makes a role or property-access change (which bumps the watermark)
    // usable rather than briefly locking the user out.
    const { accessToken: freshToken } = await loginAndGetUser(ownerEmail, ownerPassword);

    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(freshToken));
    expect(res.status).toBe(200);
  });

  it('still rejects a token minted just BEFORE the bump in that same second (precision cuts only one way)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const { accessToken, user } = await loginAndGetUser(ownerEmail, ownerPassword);

    // The token above and this bump land in the same wall-clock second,
    // so under the old second-granular comparison both sides truncated to
    // the same value. This is the case that must NOT have been traded
    // away to fix the spurious-rejection one above: an
    // issued-before-revocation token stays rejected regardless of how
    // close the two events are.
    await bumpTokensValidAfter(user.id);

    const res = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(accessToken));
    expect(res.status).toBe(401);
  });

  it('falls back to second-granular `iat` for a token with no `iatMs` claim (pre-deploy tokens fail closed)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const { user } = await loginAndGetUser(ownerEmail, ownerPassword);
    const ctx = await resolveAuthContext(user.id);

    // A token shaped like one issued by the previous deployment: signed
    // by hand without the `iatMs` claim, with an `iat` a minute in the
    // past so the fallback path has something unambiguous to compare.
    const legacyToken = jwt.sign(
      {
        sub: ctx.userId,
        organizationId: ctx.organizationId,
        permissions: ctx.permissions,
        roleNames: ctx.roleNames,
        grantedPropertyIds: ctx.grantedPropertyIds,
        iat: Math.floor(Date.now() / 1000) - 60,
      },
      env.auth.jwtSecret,
      { expiresIn: '15m' },
    );

    // Still valid before any revocation.
    const before = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(legacyToken));
    expect(before.status).toBe(200);

    await bumpTokensValidAfter(user.id);

    const after = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(legacyToken));
    expect(after.status).toBe(401);
  });

  it('deactivateUser() closes both gaps at once: the existing access token AND the refresh session', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });
    const accessToken = login.body.accessToken as string;
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });

    await deactivateUser(user.id);

    // The already-issued access token (this change).
    const protectedCall = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(accessToken));
    expect(protectedCall.status).toBe(401);

    // The refresh session (fix #1, composed here — proves the two fixes
    // combine into full closure for the original finding).
    const refreshCall = await agent.post('/api/v1/auth/refresh').send();
    expect(refreshCall.status).toBe(401);
  });

  it('never-deactivated users are unaffected (no regression to the default null-watermark case)', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();
    const { accessToken } = await loginAndGetUser(ownerEmail, ownerPassword);

    const first = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(accessToken));
    const second = await request(app)
      .get(PROTECTED_ROUTE)
      .set(...authHeader(accessToken));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  describe('cache TTL boundary (not just proactive eviction)', () => {
    const originalTtl = env.auth.tokensValidAfterCacheTtlSeconds;

    afterEach(() => {
      env.auth.tokensValidAfterCacheTtlSeconds = originalTtl;
    });

    it('keeps trusting a cached value within the TTL, then re-checks the database once it expires', async () => {
      // 300ms, test-only — long enough that the warm-up + direct-write
      // steps below can't plausibly outrun it under normal test-runner
      // load (avoiding a flaky race with a tighter value), short enough
      // to keep the test itself fast.
      env.auth.tokensValidAfterCacheTtlSeconds = 0.3;
      const { ownerEmail, ownerPassword } = await signupOrganization();
      const { accessToken, user } = await loginAndGetUser(ownerEmail, ownerPassword);

      // Warm the cache with a "not revoked" (null) entry.
      const warm = await request(app)
        .get(PROTECTED_ROUTE)
        .set(...authHeader(accessToken));
      expect(warm.status).toBe(200);

      // Write the watermark directly (bypassing bumpTokensValidAfter, so
      // the proactive cache-eviction path is deliberately NOT exercised
      // here — this test is specifically about the TTL expiry path).
      await prisma.user.update({ where: { id: user.id }, data: { tokensValidAfter: new Date() } });

      const stillCached = await request(app)
        .get(PROTECTED_ROUTE)
        .set(...authHeader(accessToken));
      expect(stillCached.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 450));

      const afterTtl = await request(app)
        .get(PROTECTED_ROUTE)
        .set(...authHeader(accessToken));
      expect(afterTtl.status).toBe(401);
    });
  });

  describe('fail-closed on a database error during a cache miss', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('rejects the request rather than treating an unreachable database as "not revoked"', async () => {
      const { ownerEmail, ownerPassword } = await signupOrganization();
      const { accessToken } = await loginAndGetUser(ownerEmail, ownerPassword);

      const spy = vi
        .spyOn(prisma.user, 'findUniqueOrThrow')
        .mockRejectedValueOnce(new Error('simulated database outage'));

      const duringOutage = await request(app)
        .get(PROTECTED_ROUTE)
        .set(...authHeader(accessToken));
      expect(duringOutage.status).toBe(401);
      expect(spy).toHaveBeenCalled();

      // Recovery: the same token works again once the database is reachable.
      const afterRecovery = await request(app)
        .get(PROTECTED_ROUTE)
        .set(...authHeader(accessToken));
      expect(afterRecovery.status).toBe(200);
    });

    it('rejects a token for a user that no longer exists', async () => {
      const { ownerEmail, ownerPassword } = await signupOrganization();
      const { accessToken } = await loginAndGetUser(ownerEmail, ownerPassword);

      const spy = vi
        .spyOn(prisma.user, 'findUniqueOrThrow')
        .mockRejectedValueOnce(Object.assign(new Error('No User found'), { code: 'P2025' }));

      const res = await request(app)
        .get(PROTECTED_ROUTE)
        .set(...authHeader(accessToken));
      expect(res.status).toBe(401);
      expect(spy).toHaveBeenCalled();
    });
  });
});

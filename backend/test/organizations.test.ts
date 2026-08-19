import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner, signupOrganization } from './helpers.js';

function signupBody(suffix: string) {
  return {
    organizationName: `Race Test ${suffix}`,
    organizationSlug: `race-test-${suffix}`,
    owner: { email: `race-${suffix}@example.com`, password: 'password1234', firstName: 'A', lastName: 'B' },
  };
}

describe('POST /api/v1/organizations (signup)', () => {
  it('creates an organization and an OWNER user that can immediately log in', async () => {
    const { ownerEmail, ownerPassword } = await signupOrganization();

    const login = await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('OWNER');
  });

  it('rejects a duplicate organization slug with 409', async () => {
    const suffix = randomUUID().slice(0, 8);
    const body = {
      organizationName: 'Dup Test',
      organizationSlug: `dup-slug-${suffix}`,
      owner: { email: `a-${suffix}@example.com`, password: 'password1234', firstName: 'A', lastName: 'B' },
    };
    const first = await request(app).post('/api/v1/organizations').send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/organizations')
      .send({ ...body, owner: { ...body.owner, email: `b-${suffix}@example.com` } });
    expect(second.status).toBe(409);
  });

  it('rejects a duplicate owner email with 409', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `dup-${suffix}@example.com`;
    const first = await request(app)
      .post('/api/v1/organizations')
      .send({
        organizationName: 'First',
        organizationSlug: `first-${suffix}`,
        owner: { email, password: 'password1234', firstName: 'A', lastName: 'B' },
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/v1/organizations')
      .send({
        organizationName: 'Second',
        organizationSlug: `second-${suffix}`,
        owner: { email, password: 'password1234', firstName: 'C', lastName: 'D' },
      });
    expect(second.status).toBe(409);
  });

  it('rejects a password shorter than 8 characters', async () => {
    const suffix = randomUUID().slice(0, 8);
    const res = await request(app)
      .post('/api/v1/organizations')
      .send({
        organizationName: 'Short PW',
        organizationSlug: `short-pw-${suffix}`,
        owner: { email: `short-${suffix}@example.com`, password: 'short', firstName: 'A', lastName: 'B' },
      });
    expect(res.status).toBe(400);
  });

  describe('race-condition backstop (the pre-check passes, the transaction does not)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('converts a real Prisma P2002 unique-constraint error from the transaction into a 409, not a raw 500', async () => {
      const suffix = randomUUID().slice(0, 8);
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`slug`)', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['slug'] },
      });
      const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(p2002);

      const res = await request(app)
        .post('/api/v1/organizations')
        .send(signupBody(suffix));

      // Proves the transaction path was actually reached (the pre-check
      // alone can't have produced this — it never touches $transaction),
      // and that the resulting P2002 is mapped to the same conflict
      // behavior a sequential duplicate gets, not an internal-error leak.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('conflict');
    });

    it('does not convert an unrelated transaction error into a conflict — it propagates as an internal error', async () => {
      const suffix = randomUUID().slice(0, 8);
      const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('simulated unrelated database failure'));

      const res = await request(app)
        .post('/api/v1/organizations')
        .send(signupBody(suffix));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(500);
      expect(res.body.error.code).not.toBe('conflict');
    });

    it('a genuinely unique signup still succeeds normally once the mock is restored (no regression to the common path)', async () => {
      const suffix = randomUUID().slice(0, 8);
      const res = await request(app)
        .post('/api/v1/organizations')
        .send(signupBody(suffix));
      expect(res.status).toBe(201);
    });
  });
});

describe('GET/PATCH /api/v1/organizations/me', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/organizations/me');
    expect(res.status).toBe(401);
  });

  it("returns and updates the caller's own organization", async () => {
    const { token } = await loginAsNewOwner();

    const get = await request(app).get('/api/v1/organizations/me').set(...authHeader(token));
    expect(get.status).toBe(200);
    const orgId = get.body.organization.id as string;

    const patch = await request(app)
      .patch('/api/v1/organizations/me')
      .set(...authHeader(token))
      .send({ name: 'Renamed Hotel Co' });
    expect(patch.status).toBe(200);
    expect(patch.body.organization.id).toBe(orgId);
    expect(patch.body.organization.name).toBe('Renamed Hotel Co');
  });
});

import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { DEMO_LOCKED_MESSAGE } from '../src/platform/rbac/demo-guard.js';
import { app, authHeader, loginAs, loginAsNewOwner } from './helpers.js';

/**
 * The public demo login is an OWNER shared by every visitor. Structural
 * changes must be refused for it (so nobody can wipe the demo for the next
 * visitor), while day-to-day operations stay open and ordinary accounts are
 * unaffected.
 */
describe('shared demo account guard', () => {
  const demoPassword = 'correct-horse-battery-staple-1';
  let demoToken: string;
  let propertyId: string;
  let roomTypeId: string;
  let guestId: string;

  beforeAll(async () => {
    // Tests share one database; clear a leftover demo org from an aborted run.
    const stale = await prisma.user.findFirst({ where: { email: env.demoEmail } });
    if (stale) await prisma.organization.delete({ where: { id: stale.organizationId } });

    // Build the workspace as a normal owner, then hand that login the demo
    // email — exactly how the live demo is provisioned (seed first).
    const suffix = randomUUID().slice(0, 8);
    const signup = await request(app)
      .post('/api/v1/organizations')
      .send({
        organizationName: `Demo Hotel ${suffix}`,
        organizationSlug: `demo-hotel-${suffix}`,
        owner: { email: `seed-${suffix}@example.com`, password: demoPassword, firstName: 'Demo', lastName: 'Owner' },
      });
    expect(signup.status).toBe(201);
    const seedToken = await loginAs(`seed-${suffix}@example.com`, demoPassword);
    const auth = authHeader(seedToken);

    const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: 'Demo House', slug: `demo-${suffix}` });
    propertyId = property.body.property.id as string;
    const roomType = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Deluxe', code: 'DLX' });
    roomTypeId = roomType.body.roomType.id as string;
    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
    guestId = guest.body.guest.id as string;

    await prisma.user.update({ where: { email: `seed-${suffix}@example.com` }, data: { email: env.demoEmail } });
    demoToken = await loginAs(env.demoEmail, demoPassword);
  });

  afterAll(async () => {
    const demo = await prisma.user.findFirst({ where: { email: env.demoEmail } });
    if (demo) await prisma.organization.delete({ where: { id: demo.organizationId } });
  });

  it('refuses structural changes with a clear 403', async () => {
    const auth = authHeader(demoToken);
    const attempts = [
      request(app).delete(`/api/v1/properties/${propertyId}`).set(...auth),
      request(app).patch(`/api/v1/properties/${propertyId}`).set(...auth).send({ name: 'Hacked' }),
      request(app).post('/api/v1/properties').set(...auth).send({ name: 'Extra', slug: 'extra-prop' }),
      request(app).delete(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`).set(...auth),
      request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'X', code: 'XX' }),
      request(app).delete(`/api/v1/guests/${guestId}`).set(...auth),
      request(app).patch('/api/v1/organizations/me').set(...auth).send({ name: 'Renamed' }),
      request(app)
        .post('/api/v1/staff')
        .set(...auth)
        .send({ email: 'intruder@example.com', firstName: 'I', lastName: 'N', role: 'ADMIN', password: demoPassword }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe(DEMO_LOCKED_MESSAGE);
    }

    // Nothing actually changed.
    const property = await request(app).get(`/api/v1/properties/${propertyId}`).set(...auth);
    expect(property.status).toBe(200);
    expect(property.body.property.name).toBe('Demo House');
    expect(await prisma.guest.count({ where: { id: guestId } })).toBe(1);
  });

  it('still allows reading and day-to-day operations', async () => {
    const auth = authHeader(demoToken);
    expect((await request(app).get(`/api/v1/properties/${propertyId}/dashboard`).set(...auth)).status).toBe(200);
    expect((await request(app).get(`/api/v1/properties/${propertyId}/room-types`).set(...auth)).status).toBe(200);
    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Walk', lastName: 'In' });
    expect(guest.status).toBe(201);
  });

  it('does not affect ordinary accounts', async () => {
    const { token } = await loginAsNewOwner('Normal');
    const auth = authHeader(token);
    const created = await request(app).post('/api/v1/properties').set(...auth).send({ name: 'Mine', slug: 'mine' });
    expect(created.status).toBe(201);
    const id = created.body.property.id as string;
    expect((await request(app).patch(`/api/v1/properties/${id}`).set(...auth).send({ name: 'Mine 2' })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/properties/${id}`).set(...auth)).status).toBe(204);
  });
});

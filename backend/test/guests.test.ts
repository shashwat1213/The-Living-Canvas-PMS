/**
 * Guests API (Phase 2 — booking core, Slice B).
 *
 * Covers CRUD, the paginated list + search contract, permission gating,
 * audit entries (and that personal contact values never enter the audit
 * metadata), and the delete-guard once a guest has reservations. A cross-org
 * case also lives in `tenant-isolation.test.ts`.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function createStaff(token: string, role: 'MANAGER' | 'STAFF') {
  const suffix = randomUUID().slice(0, 8);
  const email = `${role.toLowerCase()}-${suffix}@example.com`;
  const password = 'correct-horse-battery-staple';
  const created = await request(app)
    .post('/api/v1/staff')
    .set(...authHeader(token))
    .send({ email, password, firstName: role, lastName: suffix, role, propertyIds: [] });
  expect(created.status).toBe(201);
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  return login.body.accessToken as string;
}

describe('guests API', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/guests');
    expect(res.status).toBe(401);
  });

  it('creates, lists, reads, updates and deletes a guest', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);

    const created = await request(app)
      .post('/api/v1/guests')
      .set(...auth)
      .send({ firstName: 'Ada', lastName: 'Lovelace', email: 'Ada@Example.com', phone: '+91 98765 43210' });
    expect(created.status).toBe(201);
    expect(created.body.guest.firstName).toBe('Ada');
    expect(created.body.guest.email).toBe('ada@example.com'); // lower-cased
    expect(created.body.guest.reservationCount).toBe(0);
    const id = created.body.guest.id as string;

    const list = await request(app).get('/api/v1/guests').set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.guests).toHaveLength(1);
    expect(list.body.page.totalItems).toBe(1);

    const read = await request(app).get(`/api/v1/guests/${id}`).set(...auth);
    expect(read.status).toBe(200);
    expect(read.body.guest.id).toBe(id);

    const updated = await request(app)
      .patch(`/api/v1/guests/${id}`)
      .set(...auth)
      .send({ phone: null, notes: 'VIP' });
    expect(updated.status).toBe(200);
    expect(updated.body.guest.phone).toBeNull();
    expect(updated.body.guest.notes).toBe('VIP');

    const del = await request(app).delete(`/api/v1/guests/${id}`).set(...auth);
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/v1/guests/${id}`).set(...auth);
    expect(gone.status).toBe(404);
  });

  it('searches across name, email and phone with every term matching', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Grace', lastName: 'Hopper' });
    await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Byron' });

    // Full name spanning both columns still finds the one person.
    const byName = await request(app).get('/api/v1/guests?search=grace+hopper').set(...auth);
    expect(byName.body.guests).toHaveLength(1);
    expect(byName.body.guests[0].lastName).toBe('Hopper');

    const noMatch = await request(app).get('/api/v1/guests?search=grace+byron').set(...auth);
    expect(noMatch.body.guests).toHaveLength(0);
  });

  it('validates input', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);

    const noName = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'OnlyFirst' });
    expect(noName.status).toBe(400);

    const badEmail = await request(app)
      .post('/api/v1/guests')
      .set(...auth)
      .send({ firstName: 'A', lastName: 'B', email: 'not-an-email' });
    expect(badEmail.status).toBe(400);

    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'A', lastName: 'B' });
    const empty = await request(app).patch(`/api/v1/guests/${guest.body.guest.id}`).set(...auth).send({});
    expect(empty.status).toBe(400);
  });

  it('audits create and update but never records contact values', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);

    const created = await request(app)
      .post('/api/v1/guests')
      .set(...auth)
      .send({ firstName: 'Edith', lastName: 'Clarke', email: 'edith@example.com', phone: '+1 555 0100' });
    const id = created.body.guest.id as string;

    await request(app).patch(`/api/v1/guests/${id}`).set(...auth).send({ phone: '+1 555 0199' });
    // A no-op update writes nothing.
    await request(app).patch(`/api/v1/guests/${id}`).set(...auth).send({ firstName: 'Edith' });

    const entries = await prisma.auditLog.findMany({
      where: { organizationId, entityType: 'guest', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(['guest.created', 'guest.updated']);

    // The phone number itself must not appear anywhere in the audit metadata.
    const serialized = JSON.stringify(entries.map((e) => e.metadata));
    expect(serialized).not.toContain('555 0100');
    expect(serialized).not.toContain('555 0199');
    expect(serialized).not.toContain('edith@example.com');
    // But which field changed is recorded.
    const updateEntry = entries.find((e) => e.action === 'guest.updated');
    expect(JSON.stringify(updateEntry?.metadata)).toContain('phone');
  });

  it('refuses to delete a guest who has reservations, with a 409', async () => {
    // Uses the DB directly to attach a reservation, since the reservations
    // API lands in the next task — this proves the guard, not the booking flow.
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);

    const property = await request(app)
      .post('/api/v1/properties')
      .set(...auth)
      .send({ name: 'Guarded Inn', slug: `guarded-${randomUUID().slice(0, 8)}` });
    const propertyId = property.body.property.id as string;
    const roomType = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Standard' });
    const roomTypeId = roomType.body.roomType.id as string;
    const ratePlan = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`)
      .set(...auth)
      .send({ name: 'BAR' });
    const ratePlanId = ratePlan.body.ratePlan.id as string;
    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Booked', lastName: 'Guest' });
    const guestId = guest.body.guest.id as string;

    await prisma.reservation.create({
      data: {
        propertyId,
        roomTypeId,
        ratePlanId,
        guestId,
        reference: `LC-${randomUUID().slice(0, 6).toUpperCase()}`,
        checkIn: new Date('2026-10-01T00:00:00.000Z'),
        checkOut: new Date('2026-10-03T00:00:00.000Z'),
        totalAmountMinor: 900000,
      },
    });

    const del = await request(app).delete(`/api/v1/guests/${guestId}`).set(...auth);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('reservation');

    // Still there.
    const stillThere = await request(app).get(`/api/v1/guests/${guestId}`).set(...auth);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.guest.reservationCount).toBe(1);
    void organizationId;
  });

  it('lets STAFF manage guests (front-desk work)', async () => {
    const { token } = await loginAsNewOwner();
    const staffToken = await createStaff(token, 'STAFF');
    const staffAuth = authHeader(staffToken);

    const create = await request(app).post('/api/v1/guests').set(...staffAuth).send({ firstName: 'Walk', lastName: 'In' });
    expect(create.status).toBe(201);
  });
});

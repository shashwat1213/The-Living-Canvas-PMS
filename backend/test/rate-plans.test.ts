/**
 * Rate plans API (Phase 2 — booking core, Slice A).
 *
 * Covers the module's own contract: CRUD, the paginated list contract,
 * per-date rate read/set (bulk), permission gating on read vs manage,
 * audit entries, and validation boundaries. Cross-organization cases live
 * here *and* in `tenant-isolation.test.ts`, the standing suite every
 * tenant-scoped route reports to.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function createProperty(token: string) {
  const suffix = randomUUID().slice(0, 8);
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: `Property ${suffix}`, slug: `property-${suffix}` });
  expect(res.status).toBe(201);
  return res.body.property.id as string;
}

async function createRoomType(token: string, propertyId: string) {
  const suffix = randomUUID().slice(0, 8);
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types`)
    .set(...authHeader(token))
    .send({ name: `Deluxe ${suffix}` });
  expect(res.status).toBe(201);
  return res.body.roomType.id as string;
}

async function createStaff(token: string, role: 'MANAGER' | 'STAFF', propertyIds: string[]) {
  const suffix = randomUUID().slice(0, 8);
  const email = `${role.toLowerCase()}-${suffix}@example.com`;
  const password = 'correct-horse-battery-staple';
  const created = await request(app)
    .post('/api/v1/staff')
    .set(...authHeader(token))
    .send({ email, password, firstName: role, lastName: suffix, role, propertyIds });
  expect(created.status).toBe(201);
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  return login.body.accessToken as string;
}

function base(propertyId: string, roomTypeId: string) {
  return `/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`;
}

describe('rate plans API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);
    const res = await request(app).get(base(propertyId, roomTypeId));
    expect(res.status).toBe(401);
  });

  it('404s for a room type that does not exist', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const res = await request(app)
      .get(base(propertyId, '00000000-0000-0000-0000-000000000000'))
      .set(...authHeader(token));
    expect(res.status).toBe(404);
  });

  it('creates, lists, reads, updates and deletes a rate plan', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);

    const created = await request(app)
      .post(base(propertyId, roomTypeId))
      .set(...auth)
      .send({ name: 'Best Available Rate', code: 'bar', description: 'Flexible', isRefundable: true });
    expect(created.status).toBe(201);
    expect(created.body.ratePlan.name).toBe('Best Available Rate');
    expect(created.body.ratePlan.code).toBe('BAR'); // upper-cased
    expect(created.body.ratePlan.isRefundable).toBe(true);
    expect(created.body.ratePlan.pricedDates).toBe(0);
    const id = created.body.ratePlan.id as string;

    const list = await request(app).get(base(propertyId, roomTypeId)).set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.ratePlans).toHaveLength(1);
    expect(list.body.page.totalItems).toBe(1);

    const read = await request(app).get(`${base(propertyId, roomTypeId)}/${id}`).set(...auth);
    expect(read.status).toBe(200);
    expect(read.body.ratePlan.id).toBe(id);

    const updated = await request(app)
      .patch(`${base(propertyId, roomTypeId)}/${id}`)
      .set(...auth)
      .send({ isRefundable: false, description: null });
    expect(updated.status).toBe(200);
    expect(updated.body.ratePlan.isRefundable).toBe(false);
    expect(updated.body.ratePlan.description).toBeNull();

    const del = await request(app).delete(`${base(propertyId, roomTypeId)}/${id}`).set(...auth);
    expect(del.status).toBe(204);
    const gone = await request(app).get(`${base(propertyId, roomTypeId)}/${id}`).set(...auth);
    expect(gone.status).toBe(404);
  });

  it('rejects a duplicate name and a duplicate code (case-insensitive) within a room type', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);

    const first = await request(app)
      .post(base(propertyId, roomTypeId))
      .set(...auth)
      .send({ name: 'Non-Refundable', code: 'NR' });
    expect(first.status).toBe(201);

    const dupName = await request(app)
      .post(base(propertyId, roomTypeId))
      .set(...auth)
      .send({ name: 'Non-Refundable', code: 'NR2' });
    expect(dupName.status).toBe(409);

    const dupCode = await request(app)
      .post(base(propertyId, roomTypeId))
      .set(...auth)
      .send({ name: 'Another', code: 'nr' });
    expect(dupCode.status).toBe(409);
  });

  it('validates input', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);

    const noName = await request(app).post(base(propertyId, roomTypeId)).set(...auth).send({ code: 'X' });
    expect(noName.status).toBe(400);

    const emptyUpdate = await request(app)
      .post(base(propertyId, roomTypeId))
      .set(...auth)
      .send({ name: 'BAR' });
    const id = emptyUpdate.body.ratePlan.id as string;
    const empty = await request(app).patch(`${base(propertyId, roomTypeId)}/${id}`).set(...auth).send({});
    expect(empty.status).toBe(400);
  });

  it('sets, reads, updates and clears per-date rates in bulk', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);
    const plan = await request(app).post(base(propertyId, roomTypeId)).set(...auth).send({ name: 'BAR' });
    const id = plan.body.ratePlan.id as string;
    const rates = `${base(propertyId, roomTypeId)}/${id}/rates`;

    const set = await request(app)
      .put(rates)
      .set(...auth)
      .send({
        rates: [
          { date: '2026-10-01', amountMinor: 450000 },
          { date: '2026-10-02', amountMinor: 450000 },
          { date: '2026-10-03', amountMinor: 600000 },
        ],
      });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ set: 3, cleared: 0 });

    const read = await request(app).get(`${rates}?from=2026-10-01&to=2026-10-31`).set(...auth);
    expect(read.status).toBe(200);
    expect(read.body.rates).toEqual([
      { date: '2026-10-01', amountMinor: 450000 },
      { date: '2026-10-02', amountMinor: 450000 },
      { date: '2026-10-03', amountMinor: 600000 },
    ]);

    // Upsert one, clear another.
    const edit = await request(app)
      .put(rates)
      .set(...auth)
      .send({
        rates: [
          { date: '2026-10-01', amountMinor: 500000 },
          { date: '2026-10-02', amountMinor: null },
        ],
      });
    expect(edit.status).toBe(200);
    expect(edit.body).toEqual({ set: 1, cleared: 1 });

    const after = await request(app).get(`${rates}?from=2026-10-01&to=2026-10-03`).set(...auth);
    expect(after.body.rates).toEqual([
      { date: '2026-10-01', amountMinor: 500000 },
      { date: '2026-10-03', amountMinor: 600000 },
    ]);

    // pricedDates reflects the two remaining priced nights.
    const readPlan = await request(app).get(`${base(propertyId, roomTypeId)}/${id}`).set(...auth);
    expect(readPlan.body.ratePlan.pricedDates).toBe(2);
  });

  it('rejects an inverted or over-long rate window', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);
    const plan = await request(app).post(base(propertyId, roomTypeId)).set(...auth).send({ name: 'BAR' });
    const id = plan.body.ratePlan.id as string;
    const rates = `${base(propertyId, roomTypeId)}/${id}/rates`;

    const inverted = await request(app).get(`${rates}?from=2026-10-10&to=2026-10-01`).set(...auth);
    expect(inverted.status).toBe(400);

    const tooLong = await request(app).get(`${rates}?from=2026-01-01&to=2027-06-01`).set(...auth);
    expect(tooLong.status).toBe(400);
  });

  it('writes an audit entry on create and on a rates-set, and none on a no-op update', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);

    const plan = await request(app).post(base(propertyId, roomTypeId)).set(...auth).send({ name: 'BAR', code: 'BAR' });
    const id = plan.body.ratePlan.id as string;

    await request(app)
      .put(`${base(propertyId, roomTypeId)}/${id}/rates`)
      .set(...auth)
      .send({ rates: [{ date: '2026-12-24', amountMinor: 999900 }] });

    // No-op update (same name) writes nothing.
    await request(app).patch(`${base(propertyId, roomTypeId)}/${id}`).set(...auth).send({ name: 'BAR' });

    const entries = await prisma.auditLog.findMany({
      where: { organizationId, entityType: 'rate_plan', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('rate_plan.created');
    expect(actions).toContain('rate_plan.rates_set');
    expect(actions).not.toContain('rate_plan.updated');
  });

  it('lets STAFF read rate plans but not manage them', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);
    const staffToken = await createStaff(token, 'STAFF', [propertyId]);
    const staffAuth = authHeader(staffToken);

    const read = await request(app).get(base(propertyId, roomTypeId)).set(...staffAuth);
    expect(read.status).toBe(200);

    const create = await request(app).post(base(propertyId, roomTypeId)).set(...staffAuth).send({ name: 'Sneaky' });
    expect(create.status).toBe(403);
  });
});

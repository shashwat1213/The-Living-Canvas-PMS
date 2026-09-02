/**
 * RoomType API (Phase 2 task 2b — see TASKS.md).
 *
 * Covers the module's own contract: CRUD, the paginated list contract,
 * permission gating on both the read and manage keys, audit entries, and
 * the rule that a type still assigned to rooms cannot be hard-deleted.
 * Cross-organization cases live here *and* in `tenant-isolation.test.ts`,
 * which is the standing suite every tenant-scoped route reports to.
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
  return res.body.property.id as string;
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

describe('/api/v1/properties/:propertyId/room-types', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);

    const res = await request(app).get(`/api/v1/properties/${propertyId}/room-types`);
    expect(res.status).toBe(401);
  });

  it('404s for a property that does not exist', async () => {
    const { token } = await loginAsNewOwner();
    const res = await request(app)
      .get('/api/v1/properties/00000000-0000-0000-0000-000000000000/room-types')
      .set(...authHeader(token));
    expect(res.status).toBe(404);
  });

  it('creates, lists, reads, updates and deletes a room type', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const create = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Deluxe King', code: 'dlxk', description: 'One king bed, city view.' });
    expect(create.status).toBe(201);
    const roomTypeId = create.body.roomType.id as string;
    // Codes are upper-cased on the way in so the uniqueness constraint
    // can't be sidestepped by casing.
    expect(create.body.roomType.code).toBe('DLXK');
    expect(create.body.roomType.isActive).toBe(true);
    expect(create.body.roomType.roomCount).toBe(0);

    const list = await request(app)
      .get(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.roomTypes).toHaveLength(1);
    expect(list.body.page).toMatchObject({ page: 1, totalItems: 1, totalPages: 1 });

    const read = await request(app)
      .get(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth);
    expect(read.status).toBe(200);
    expect(read.body.roomType.name).toBe('Deluxe King');

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth)
      .send({ name: 'Deluxe King Suite', isActive: false });
    expect(update.status).toBe(200);
    expect(update.body.roomType.name).toBe('Deluxe King Suite');
    expect(update.body.roomType.isActive).toBe(false);

    const removed = await request(app)
      .delete(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth);
    expect(removed.status).toBe(204);

    const gone = await request(app)
      .get(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth);
    expect(gone.status).toBe(404);
  });

  it('rejects a duplicate name or code at the same property, but allows both at another', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const otherPropertyId = await createProperty(token);

    const first = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Standard', code: 'STD' });
    expect(first.status).toBe(201);

    const dupName = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Standard', code: 'OTHER' });
    expect(dupName.status).toBe(409);

    // Casing must not be a way around the constraint.
    const dupCode = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Different', code: 'std' });
    expect(dupCode.status).toBe(409);

    // The catalogue is per property, so the same names belong to another.
    const otherProperty = await request(app)
      .post(`/api/v1/properties/${otherPropertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Standard', code: 'STD' });
    expect(otherProperty.status).toBe(201);
  });

  it('validates its input rather than silently coercing it', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const cases = [
      { body: {}, why: 'no name' },
      { body: { name: '' }, why: 'empty name' },
      { body: { name: 'Fine', code: 'has space' }, why: 'code with a space' },
      { body: { name: 'Fine', code: 'x'.repeat(13) }, why: 'code too long' },
      { body: { name: 'x'.repeat(81) }, why: 'name too long' },
    ];
    for (const { body, why } of cases) {
      const res = await request(app)
        .post(`/api/v1/properties/${propertyId}/room-types`)
        .set(...auth)
        .send(body);
      expect(res.status, why).toBe(400);
    }

    const emptyPatch = await request(app)
      .patch(`/api/v1/properties/${propertyId}/room-types/00000000-0000-0000-0000-000000000000`)
      .set(...auth)
      .send({});
    expect(emptyPatch.status).toBe(400);
  });
});

describe('room types in use cannot be hard-deleted', () => {
  it('refuses with 409 and reports the count, leaving the rooms untouched', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const roomType = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Suite' });
    const roomTypeId = roomType.body.roomType.id as string;

    // The rooms API doesn't accept roomTypeId yet (task 2b's second half),
    // so the link is made directly — this test is about the delete rule.
    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '301', roomType: 'Suite' });
    await prisma.room.update({ where: { id: room.body.room.id }, data: { roomTypeId } });

    const refused = await request(app)
      .delete(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain('1 room');

    // The room must still exist, and still be typed: a refused delete
    // that had already nulled the FK would be the exact data loss the
    // rule exists to prevent.
    const survivor = await prisma.room.findUnique({ where: { id: room.body.room.id } });
    expect(survivor?.roomTypeId).toBe(roomTypeId);

    // Retiring it is the operation the caller actually wanted.
    const retired = await request(app)
      .patch(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth)
      .send({ isActive: false });
    expect(retired.status).toBe(200);
    expect(retired.body.roomType.isActive).toBe(false);
    expect(retired.body.roomType.roomCount).toBe(1);
  });
});

describe('room-type permissions', () => {
  it('lets STAFF read the catalogue but not change it', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const staffToken = await createStaff(token, 'STAFF', [propertyId]);
    const staffAuth = authHeader(staffToken);

    const read = await request(app)
      .get(`/api/v1/properties/${propertyId}/room-types`)
      .set(...staffAuth);
    expect(read.status).toBe(200);

    const create = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...staffAuth)
      .send({ name: 'Staff Made This' });
    expect(create.status).toBe(403);
  });

  it('lets a MANAGER configure the catalogue at a property they are granted', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const managerToken = await createStaff(token, 'MANAGER', [propertyId]);

    const create = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...authHeader(managerToken))
      .send({ name: 'Manager Made This' });
    expect(create.status).toBe(201);
  });

  it('refuses a MANAGER at a property they hold no grant for', async () => {
    const { token } = await loginAsNewOwner();
    const grantedId = await createProperty(token);
    const ungrantedId = await createProperty(token);
    const managerToken = await createStaff(token, 'MANAGER', [grantedId]);

    const res = await request(app)
      .get(`/api/v1/properties/${ungrantedId}/room-types`)
      .set(...authHeader(managerToken));
    expect(res.status).toBe(403);
  });
});

describe('room-type mutations are audited', () => {
  it('records creation, update and deletion, and nothing for a refused action', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const created = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Audited Type', code: 'AUD' });
    const roomTypeId = created.body.roomType.id as string;

    await request(app)
      .patch(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth)
      .send({ name: 'Audited Type Renamed' });

    // Re-sending an unchanged value must not produce an entry claiming a
    // change — same rule the property and room diffs follow.
    await request(app)
      .patch(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth)
      .send({ name: 'Audited Type Renamed' });

    await request(app)
      .delete(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth);

    const trail = await request(app)
      .get(`/api/v1/audit-logs?entityId=${roomTypeId}&pageSize=50`)
      .set(...auth);
    const actions = (trail.body.auditLogs as { action: string }[]).map((entry) => entry.action).sort();
    expect(actions).toEqual(['room_type.created', 'room_type.deleted', 'room_type.updated']);

    const update = (trail.body.auditLogs as { action: string; metadata: Record<string, unknown> }[]).find(
      (entry) => entry.action === 'room_type.updated',
    );
    expect(update?.metadata.changed).toMatchObject({
      name: { from: 'Audited Type', to: 'Audited Type Renamed' },
    });
  });
});

describe('a room type code and description can be cleared', () => {
  it('accepts null to remove a previously-set code and description, and audits the clear', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const created = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Clearable', code: 'CLR', description: 'Has both fields set.' });
    expect(created.status).toBe(201);
    const roomTypeId = created.body.roomType.id as string;
    expect(created.body.roomType.code).toBe('CLR');
    expect(created.body.roomType.description).toBe('Has both fields set.');

    // Null explicitly clears; the DB columns are nullable and the update
    // schema now accepts it (2d's follow-up).
    const cleared = await request(app)
      .patch(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth)
      .send({ code: null, description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.roomType.code).toBeNull();
    expect(cleared.body.roomType.description).toBeNull();

    // Persisted, not just echoed.
    const reread = await request(app)
      .get(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}`)
      .set(...auth);
    expect(reread.body.roomType.code).toBeNull();
    expect(reread.body.roomType.description).toBeNull();

    // The clear is a real change, so it is audited as one.
    const trail = await request(app)
      .get(`/api/v1/audit-logs?entityId=${roomTypeId}&pageSize=50`)
      .set(...auth);
    const update = (trail.body.auditLogs as { action: string; metadata: Record<string, unknown> }[]).find(
      (entry) => entry.action === 'room_type.updated',
    );
    expect(update?.metadata.changed).toMatchObject({
      code: { from: 'CLR', to: null },
      description: { from: 'Has both fields set.', to: null },
    });

    // An omitted key still means "leave unchanged" — clearing code must
    // not have wiped the name.
    expect(reread.body.roomType.name).toBe('Clearable');
  });
});

/**
 * Rooms ↔ RoomType integration (Phase 2 task 2c — see TASKS.md).
 *
 * The load-bearing rule here is that a room can only ever reference a
 * room type belonging to its *own* property, in its own tenant. The
 * legacy free-text `roomType` keeps working untouched — every case that
 * passed before this slice must still pass, which is what the
 * backward-compatibility block at the bottom exists to prove.
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

async function createRoomType(token: string, propertyId: string, name = 'Deluxe King') {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types`)
    .set(...authHeader(token))
    .send({ name });
  return res.body.roomType.id as string;
}

describe('creating a room with a room type', () => {
  it('links the room and fills the legacy label in from the type', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId, 'Deluxe King');

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomTypeId });

    expect(res.status).toBe(201);
    expect(res.body.room.roomTypeId).toBe(roomTypeId);
    // The legacy column is still what the list searches and the audit
    // trail records, so it must not be left empty or stale.
    expect(res.body.room.roomType).toBe('Deluxe King');
  });

  it('keeps an explicitly supplied label rather than overwriting it', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId, 'Deluxe King');

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(token))
      .send({ name: '102', roomTypeId, roomType: 'Deluxe King (accessible)' });

    expect(res.status).toBe(201);
    expect(res.body.room.roomTypeId).toBe(roomTypeId);
    expect(res.body.room.roomType).toBe('Deluxe King (accessible)');
  });

  it('still accepts the legacy free-text form with no room type at all', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(token))
      .send({ name: '103', roomType: 'Standard Twin', capacity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.room.roomType).toBe('Standard Twin');
    expect(res.body.room.roomTypeId).toBeNull();
  });

  it('rejects a body with neither roomType nor roomTypeId', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(token))
      .send({ name: '104' });

    expect(res.status).toBe(400);
  });
});

describe('updating a room with a room type', () => {
  it('links an existing room and refreshes the legacy label', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId, 'Suite');

    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '201', roomType: 'Standard' });

    const res = await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${room.body.room.id}`)
      .set(...auth)
      .send({ roomTypeId });

    expect(res.status).toBe(200);
    expect(res.body.room.roomTypeId).toBe(roomTypeId);
    expect(res.body.room.roomType).toBe('Suite');
  });

  it('clears the link when roomTypeId is null, leaving the label alone', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId, 'Suite');

    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '202', roomTypeId });

    const res = await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${room.body.room.id}`)
      .set(...auth)
      .send({ roomTypeId: null });

    expect(res.status).toBe(200);
    expect(res.body.room.roomTypeId).toBeNull();
    expect(res.body.room.roomType).toBe('Suite');
  });

  it('still accepts a legacy free-text update, leaving the link untouched', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId, 'Suite');

    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '203', roomTypeId });

    const res = await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${room.body.room.id}`)
      .set(...auth)
      .send({ roomType: 'Renamed By Hand' });

    expect(res.status).toBe(200);
    expect(res.body.room.roomType).toBe('Renamed By Hand');
    expect(res.body.room.roomTypeId).toBe(roomTypeId);
  });
});

describe('a room can only reference a room type from its own property and tenant', () => {
  it('rejects a room type id that does not exist, writing nothing', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '301', roomTypeId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);

    // The transaction must have rolled back: no half-written room.
    const rooms = await prisma.room.findMany({ where: { propertyId, name: '301' } });
    expect(rooms).toHaveLength(0);
  });

  it('rejects a malformed room type id as a validation error', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);

    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(token))
      .send({ name: '302', roomTypeId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it("rejects a room type from another property in the SAME organization", async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyA = await createProperty(token);
    const propertyB = await createProperty(token);
    const typeAtB = await createRoomType(token, propertyB, 'B Only');

    const create = await request(app)
      .post(`/api/v1/properties/${propertyA}/rooms`)
      .set(...auth)
      .send({ name: '303', roomTypeId: typeAtB });
    expect(create.status).toBe(404);
    expect(await prisma.room.findMany({ where: { propertyId: propertyA, name: '303' } })).toHaveLength(0);

    // And the same rule on update, which is a separate code path.
    const room = await request(app)
      .post(`/api/v1/properties/${propertyA}/rooms`)
      .set(...auth)
      .send({ name: '304', roomType: 'Standard' });
    const update = await request(app)
      .patch(`/api/v1/properties/${propertyA}/rooms/${room.body.room.id}`)
      .set(...auth)
      .send({ roomTypeId: typeAtB });
    expect(update.status).toBe(404);

    const untouched = await prisma.room.findUnique({ where: { id: room.body.room.id } });
    expect(untouched?.roomTypeId).toBeNull();
    expect(untouched?.roomType).toBe('Standard');
  });

  it("rejects a room type from another ORGANIZATION", async () => {
    const orgA = await loginAsNewOwner('Rooms RT Org A');
    const orgB = await loginAsNewOwner('Rooms RT Org B');
    const propertyA = await createProperty(orgA.token);
    const propertyB = await createProperty(orgB.token);
    const typeAtB = await createRoomType(orgB.token, propertyB, 'B Deluxe');

    const res = await request(app)
      .post(`/api/v1/properties/${propertyA}/rooms`)
      .set(...authHeader(orgA.token))
      .send({ name: '305', roomTypeId: typeAtB });

    // Same 404 as a nonexistent id — org A must not learn org B's type exists.
    expect(res.status).toBe(404);
    expect(await prisma.room.findMany({ where: { propertyId: propertyA, name: '305' } })).toHaveLength(0);

    // And org B's type must be entirely unaffected.
    const survivor = await prisma.roomType.findUnique({ where: { id: typeAtB } });
    expect(survivor?.propertyId).toBe(propertyB);
  });

  it('still requires authentication and permission', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId);

    const anon = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .send({ name: '306', roomTypeId });
    expect(anon.status).toBe(401);
  });
});

describe('the room type change is audited', () => {
  it('records roomTypeId in the update diff', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);
    const roomTypeId = await createRoomType(token, propertyId, 'Audited Suite');

    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '401', roomType: 'Standard' });
    const roomId = room.body.room.id as string;

    await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth)
      .send({ roomTypeId });

    const trail = await request(app)
      .get(`/api/v1/audit-logs?entityId=${roomId}&action=room.updated`)
      .set(...auth);

    const changed = trail.body.auditLogs[0]?.metadata?.changed as Record<string, { from: unknown; to: unknown }>;
    expect(changed.roomTypeId).toMatchObject({ from: null, to: roomTypeId });
    expect(changed.roomType).toMatchObject({ from: 'Standard', to: 'Audited Suite' });
  });

  it('writes no audit entry when the rejected update never happened', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyA = await createProperty(token);
    const propertyB = await createProperty(token);
    const typeAtB = await createRoomType(token, propertyB, 'Elsewhere');

    const room = await request(app)
      .post(`/api/v1/properties/${propertyA}/rooms`)
      .set(...auth)
      .send({ name: '402', roomType: 'Standard' });
    const roomId = room.body.room.id as string;

    const before = await request(app)
      .get(`/api/v1/audit-logs?entityId=${roomId}`)
      .set(...auth);

    await request(app)
      .patch(`/api/v1/properties/${propertyA}/rooms/${roomId}`)
      .set(...auth)
      .send({ roomTypeId: typeAtB });

    const after = await request(app)
      .get(`/api/v1/audit-logs?entityId=${roomId}`)
      .set(...auth);

    expect(after.body.page.totalItems).toBe(before.body.page.totalItems);
  });
});

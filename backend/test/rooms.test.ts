import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function createProperty(token: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: 'Main House', slug: 'main-house' });
  return res.body.property.id as string;
}

describe('/api/v1/properties/:propertyId/rooms', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);

    const res = await request(app).get(`/api/v1/properties/${propertyId}/rooms`);
    expect(res.status).toBe(401);
  });

  it('404s for a property ID that does not exist', async () => {
    const { token } = await loginAsNewOwner();
    const res = await request(app)
      .get('/api/v1/properties/00000000-0000-0000-0000-000000000000/rooms')
      .set(...authHeader(token));
    expect(res.status).toBe(404);
  });

  it('creates, lists, reads, updates, and deletes a room', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const create = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomType: 'Deluxe King', capacity: 2 });
    expect(create.status).toBe(201);
    const roomId = create.body.room.id as string;
    expect(create.body.room.status).toBe('ACTIVE');

    const list = await request(app)
      .get(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.rooms).toHaveLength(1);

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth)
      .send({ status: 'MAINTENANCE' });
    expect(update.status).toBe(200);
    expect(update.body.room.status).toBe('MAINTENANCE');

    const del = await request(app)
      .delete(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth);
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects a duplicate room name within the same property with 409', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomType: 'Standard' });
    const dup = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomType: 'Standard' });

    expect(dup.status).toBe(409);
  });
});

describe('rooms listing: pagination, search and filters', () => {
  async function seedRooms() {
    const owner = await loginAsNewOwner('Room Roster Org');
    const property = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Roster House', slug: `roster-${randomUUID().slice(0, 8)}` });
    const propertyId = property.body.property.id as string;

    const seeds = [
      { name: '101', roomType: 'Deluxe King', floor: '1' },
      { name: '102', roomType: 'Deluxe Twin', floor: '1' },
      { name: '201', roomType: 'Standard King', floor: '2' },
      { name: '202', roomType: 'Suite', floor: '2' },
      { name: '301', roomType: 'Suite', floor: '3' },
    ];
    for (const seed of seeds) {
      const res = await request(app)
        .post(`/api/v1/properties/${propertyId}/rooms`)
        .set(...authHeader(owner.token))
        .send(seed);
      if (res.status !== 201) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { owner, propertyId };
  }

  function list(token: string, propertyId: string, query = '') {
    return request(app)
      .get(`/api/v1/properties/${propertyId}/rooms${query}`)
      .set(...authHeader(token));
  }

  it('returns the shared pagination envelope', async () => {
    const { owner, propertyId } = await seedRooms();

    const res = await list(owner.token, propertyId);

    expect(res.status).toBe(200);
    expect(res.body.page).toEqual({ page: 1, pageSize: 25, totalItems: 5, totalPages: 1 });
  });

  it('orders by room name, which is how a property is actually walked', async () => {
    const { owner, propertyId } = await seedRooms();

    const res = await list(owner.token, propertyId);

    expect(res.body.rooms.map((r: { name: string }) => r.name)).toEqual(['101', '102', '201', '202', '301']);
  });

  it('pages without dropping or duplicating a row', async () => {
    const { owner, propertyId } = await seedRooms();

    const p1 = await list(owner.token, propertyId, '?page=1&pageSize=2');
    const p2 = await list(owner.token, propertyId, '?page=2&pageSize=2');
    const p3 = await list(owner.token, propertyId, '?page=3&pageSize=2');

    expect(p1.body.rooms).toHaveLength(2);
    expect(p3.body.rooms).toHaveLength(1);
    const ids = [...p1.body.rooms, ...p2.body.rooms, ...p3.body.rooms].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('searches name, room type and floor', async () => {
    const { owner, propertyId } = await seedRooms();

    expect((await list(owner.token, propertyId, '?search=suite')).body.page.totalItems).toBe(2);
    expect((await list(owner.token, propertyId, '?search=101')).body.page.totalItems).toBe(1);
    // Every term must match: "deluxe king" excludes the twin.
    expect((await list(owner.token, propertyId, '?search=deluxe%20king')).body.page.totalItems).toBe(1);
  });

  it('filters by the full room status enum', async () => {
    const { owner, propertyId } = await seedRooms();
    const rooms = await list(owner.token, propertyId);
    const target = rooms.body.rooms[0];

    await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${target.id}`)
      .set(...authHeader(owner.token))
      .send({ status: 'MAINTENANCE' });

    const maintenance = await list(owner.token, propertyId, '?status=MAINTENANCE');
    expect(maintenance.body.page.totalItems).toBe(1);
    expect(maintenance.body.rooms[0].id).toBe(target.id);

    expect((await list(owner.token, propertyId, '?status=ACTIVE')).body.page.totalItems).toBe(4);
  });

  it('rejects invalid pagination and filter values', async () => {
    const { owner, propertyId } = await seedRooms();

    expect((await list(owner.token, propertyId, '?pageSize=101')).status).toBe(400);
    expect((await list(owner.token, propertyId, '?status=BROKEN')).status).toBe(400);
  });

  it('still 404s for a property outside the caller organization, even with filters', async () => {
    const { propertyId } = await seedRooms();
    const other = await loginAsNewOwner('Room Iso Org');

    const res = await list(other.token, propertyId, '?search=suite&pageSize=100');

    expect(res.status).toBe(404);
  });
});

describe('room mutations are audited', () => {
  async function seedRoom() {
    const owner = await loginAsNewOwner('Room Audit Org');
    const property = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Audit House', slug: `audit-${randomUUID().slice(0, 8)}` });
    const propertyId = property.body.property.id as string;

    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(owner.token))
      .send({ name: '101', roomType: 'Deluxe King' });

    return { owner, propertyId, roomId: room.body.room.id as string };
  }

  function auditFor(organizationId: string, action: string) {
    return prisma.auditLog.findMany({ where: { organizationId, action }, orderBy: { createdAt: 'asc' } });
  }

  it('records a creation', async () => {
    const { owner, propertyId, roomId } = await seedRoom();

    const rows = await auditFor(owner.organizationId, 'room.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('room');
    expect(rows[0]!.entityId).toBe(roomId);
    expect(rows[0]!.metadata).toEqual({ propertyId, name: '101', roomType: 'Deluxe King' });
  });

  it('records a status change as an update diff', async () => {
    const { owner, propertyId, roomId } = await seedRoom();

    await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...authHeader(owner.token))
      .send({ status: 'MAINTENANCE' });

    const rows = await auditFor(owner.organizationId, 'room.updated');
    expect(rows).toHaveLength(1);
    const metadata = rows[0]!.metadata as { changed: Record<string, unknown> };
    expect(metadata.changed).toEqual({ status: { from: 'ACTIVE', to: 'MAINTENANCE' } });
  });

  it('writes no update entry when nothing moved', async () => {
    const { owner, propertyId, roomId } = await seedRoom();

    await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...authHeader(owner.token))
      .send({ roomType: 'Deluxe King' });

    expect(await auditFor(owner.organizationId, 'room.updated')).toHaveLength(0);
  });

  it('records a deletion with what was removed', async () => {
    const { owner, propertyId, roomId } = await seedRoom();

    await request(app)
      .delete(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...authHeader(owner.token));

    const rows = await auditFor(owner.organizationId, 'room.deleted');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(roomId);
    expect(rows[0]!.metadata).toEqual({ propertyId, name: '101', roomType: 'Deluxe King' });
  });
});

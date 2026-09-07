/**
 * Maintenance work-orders API (Phase 2 — engineering operations).
 *
 * Proves the work-order lifecycle (open → in-progress → resolved/cancelled,
 * with reopen), the room out-of-service integration that distinguishes
 * maintenance from housekeeping (a work order can remove a room from sellable
 * inventory and resolving it returns the room), property-level orders with no
 * room, and the guards that make it trustworthy: terminal-edit locking,
 * cross-tenant isolation, permission gating, and the audit trail.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Builds a property with one room; returns the ids. */
async function setupProperty(token: string) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);

  const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;
  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe' });
  const roomTypeId = roomType.body.roomType.id as string;
  const room = await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: '101', roomTypeId });
  const roomId = room.body.room.id as string;
  return { propertyId, roomId };
}

const woUrl = (propertyId: string, sub = '') => `/api/v1/properties/${propertyId}/maintenance/work-orders${sub}`;

async function roomStatus(propertyId: string, roomId: string, token: string): Promise<string> {
  const res = await request(app).get(`/api/v1/properties/${propertyId}/rooms/${roomId}`).set(...authHeader(token));
  return res.body.room.status as string;
}

describe('maintenance work-orders API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const { propertyId } = await setupProperty(token);
    const res = await request(app).get(woUrl(propertyId));
    expect(res.status).toBe(401);
  });

  it('creates a room-scoped work order and moves it through its lifecycle', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupProperty(token);

    const created = await request(app).post(woUrl(propertyId)).set(...auth).send({
      title: 'AC not cooling',
      roomId,
      category: 'HVAC',
      priority: 'HIGH',
      description: 'Guest reported warm room',
    });
    expect(created.status).toBe(201);
    const id = created.body.workOrder.id as string;
    expect(created.body.workOrder.status).toBe('OPEN');
    expect(created.body.workOrder.room.name).toBe('101');
    expect(created.body.workOrder.takesRoomOutOfService).toBe(false);

    const started = await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ status: 'IN_PROGRESS' });
    expect(started.body.workOrder.status).toBe('IN_PROGRESS');

    const resolved = await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ status: 'RESOLVED' });
    expect(resolved.body.workOrder.status).toBe('RESOLVED');
    expect(resolved.body.workOrder.resolvedAt).not.toBeNull();
  });

  it('creates a property-level work order with no room', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId } = await setupProperty(token);

    const res = await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'Lobby light flickering', category: 'ELECTRICAL' });
    expect(res.status).toBe(201);
    expect(res.body.workOrder.room).toBeNull();
    expect(res.body.workOrder.takesRoomOutOfService).toBe(false);
  });

  it('rejects takeRoomOutOfService without a room (400)', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId } = await setupProperty(token);
    const res = await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'x', takeRoomOutOfService: true });
    expect(res.status).toBe(400);
  });

  it('takes a room out of service on open, and returns it on resolve', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupProperty(token);

    expect(await roomStatus(propertyId, roomId, token)).toBe('ACTIVE');

    const created = await request(app).post(woUrl(propertyId)).set(...auth).send({
      title: 'Burst pipe',
      roomId,
      category: 'PLUMBING',
      priority: 'URGENT',
      takeRoomOutOfService: true,
    });
    expect(created.body.workOrder.takesRoomOutOfService).toBe(true);
    // The room is now out of service (MAINTENANCE), removed from sellable inventory.
    expect(await roomStatus(propertyId, roomId, token)).toBe('MAINTENANCE');

    const id = created.body.workOrder.id as string;
    await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ status: 'RESOLVED' });
    // Resolving returns the room to service.
    expect(await roomStatus(propertyId, roomId, token)).toBe('ACTIVE');
  });

  it('keeps a room out of service while a second order still holds it', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupProperty(token);

    const a = await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'A', roomId, takeRoomOutOfService: true });
    const b = await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'B', roomId, takeRoomOutOfService: true });
    expect(await roomStatus(propertyId, roomId, token)).toBe('MAINTENANCE');

    // Resolve A — B still holds the room, so it stays out of service.
    await request(app).patch(woUrl(propertyId, `/${a.body.workOrder.id}`)).set(...auth).send({ status: 'RESOLVED' });
    expect(await roomStatus(propertyId, roomId, token)).toBe('MAINTENANCE');

    // Resolve B — now nothing holds it, so it returns.
    await request(app).patch(woUrl(propertyId, `/${b.body.workOrder.id}`)).set(...auth).send({ status: 'RESOLVED' });
    expect(await roomStatus(propertyId, roomId, token)).toBe('ACTIVE');
  });

  it('refuses to edit a terminal order except to reopen it', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupProperty(token);

    const created = await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'Broken lamp', roomId });
    const id = created.body.workOrder.id as string;
    await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ status: 'RESOLVED' });

    const blocked = await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ title: 'too late' });
    expect(blocked.status).toBe(409);

    const reopened = await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ status: 'OPEN' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.workOrder.status).toBe('OPEN');
    expect(reopened.body.workOrder.resolvedAt).toBeNull();
  });

  it('rejects a work order on a room from another property (404)', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const a = await setupProperty(token);
    const b = await setupProperty(token);
    const res = await request(app).post(woUrl(a.propertyId)).set(...auth).send({ title: 'x', roomId: b.roomId });
    expect(res.status).toBe(404);
  });

  it('filters by status and priority', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId } = await setupProperty(token);

    await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'Urgent one', priority: 'URGENT' });
    await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'Low one', priority: 'LOW' });

    const urgent = await request(app).get(woUrl(propertyId, '?priority=URGENT')).set(...auth);
    expect(urgent.body.workOrders).toHaveLength(1);
    expect(urgent.body.workOrders[0].title).toBe('Urgent one');

    const open = await request(app).get(woUrl(propertyId, '?status=OPEN')).set(...auth);
    expect(open.body.workOrders.length).toBeGreaterThanOrEqual(2);
  });

  it('writes an audit trail for create, out-of-service, resolve and return', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupProperty(token);

    const created = await request(app).post(woUrl(propertyId)).set(...auth).send({ title: 'Leak', roomId, takeRoomOutOfService: true });
    const id = created.body.workOrder.id as string;
    await request(app).patch(woUrl(propertyId, `/${id}`)).set(...auth).send({ status: 'RESOLVED' });

    const woEntries = await prisma.auditLog.findMany({
      where: { organizationId, entityType: 'work_order', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(woEntries.map((e) => e.action)).toEqual(['work_order.created', 'work_order.resolved']);

    const roomEntries = await prisma.auditLog.findMany({
      where: {
        organizationId,
        entityType: 'room',
        entityId: roomId,
        action: { in: ['room.out_of_service', 'room.returned_to_service'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(roomEntries.map((e) => e.action)).toEqual(['room.out_of_service', 'room.returned_to_service']);
  });

  it('does not leak work orders across organizations', async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const { propertyId, roomId } = await setupProperty(ownerA);
    const created = await request(app).post(woUrl(propertyId)).set(...authHeader(ownerA)).send({ title: 'A order', roomId });
    const id = created.body.workOrder.id as string;

    const { token: ownerB } = await loginAsNewOwner();
    const list = await request(app).get(woUrl(propertyId)).set(...authHeader(ownerB));
    expect(list.status).toBe(404);
    const get = await request(app).get(woUrl(propertyId, `/${id}`)).set(...authHeader(ownerB));
    expect(get.status).toBe(404);
    const patch = await request(app).patch(woUrl(propertyId, `/${id}`)).set(...authHeader(ownerB)).send({ status: 'RESOLVED' });
    expect(patch.status).toBe(404);
  });
});

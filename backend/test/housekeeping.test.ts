/**
 * Housekeeping API (Phase 2 — daily operations).
 *
 * Proves the board (rooms with cleaning condition + derived occupancy), the
 * room-condition transitions, the cleaning-task lifecycle, and — the
 * cross-module hook — that checking a guest out marks the room DIRTY and opens
 * a DEPARTURE task. Also covers the guards that make it trustworthy: closed-
 * task editing, cross-tenant isolation, permission gating, and the audit trail.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

/**
 * Builds a bookable property with one room and one confirmed booking, and
 * returns the ids needed to exercise housekeeping. Stay is 2 nights on
 * 2026-10-01 → 2026-10-03.
 */
async function setupBooking(token: string) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);

  const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;

  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe King' });
  const roomTypeId = roomType.body.roomType.id as string;

  const room = await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: '101', roomTypeId });
  const roomId = room.body.room.id as string;

  const ratePlan = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`)
    .set(...auth)
    .send({ name: 'Best Available Rate', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;

  const rates = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amountMinor: 450000 }));
  await request(app).put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`).set(...auth).send({ rates });

  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;

  const booking = await request(app)
    .post(`/api/v1/properties/${propertyId}/reservations`)
    .set(...auth)
    .send({ guestId, roomTypeId, ratePlanId, checkIn: '2026-10-01', checkOut: '2026-10-03' });
  const reservationId = booking.body.reservation.id as string;

  return { propertyId, roomTypeId, roomId, reservationId };
}

const hkUrl = (propertyId: string, sub = '') => `/api/v1/properties/${propertyId}/housekeeping${sub}`;

describe('housekeeping API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const { propertyId } = await setupBooking(token);
    const res = await request(app).get(hkUrl(propertyId, '/board'));
    expect(res.status).toBe(401);
  });

  it('renders a board: a fresh room is INSPECTED and vacant', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupBooking(token);

    const res = await request(app).get(hkUrl(propertyId, '/board')).set(...auth);
    expect(res.status).toBe(200);
    const room = res.body.board.rooms.find((r: { id: string }) => r.id === roomId);
    expect(room.housekeepingStatus).toBe('INSPECTED');
    expect(room.occupancy).toBe('VACANT');
    expect(room.openTasks).toBe(0);
    expect(res.body.board.summary.totalRooms).toBe(1);
    expect(res.body.board.summary.inspected).toBe(1);
  });

  it('derives DEPARTURE occupancy on the checkout date', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId, reservationId } = await setupBooking(token);
    // Assign the room so the reservation is tied to it for the board.
    await request(app).post(`/api/v1/properties/${propertyId}/reservations/${reservationId}/assign-room`).set(...auth).send({ roomId });

    // checkOut is 2026-10-03 — a departure that day.
    const board = await request(app).get(hkUrl(propertyId, '/board?date=2026-10-03')).set(...auth);
    const room = board.body.board.rooms.find((r: { id: string }) => r.id === roomId);
    expect(room.occupancy).toBe('DEPARTURE');
    // 2026-10-02 is a stayover night.
    const mid = await request(app).get(hkUrl(propertyId, '/board?date=2026-10-02')).set(...auth);
    expect(mid.body.board.rooms.find((r: { id: string }) => r.id === roomId).occupancy).toBe('STAYOVER');
  });

  it('sets a room condition and records the transition, and is a no-op when unchanged', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupBooking(token);

    const dirty = await request(app).put(hkUrl(propertyId, `/rooms/${roomId}/condition`)).set(...auth).send({ housekeepingStatus: 'DIRTY' });
    expect(dirty.status).toBe(200);
    expect(dirty.body.room.housekeepingStatus).toBe('DIRTY');

    const clean = await request(app).put(hkUrl(propertyId, `/rooms/${roomId}/condition`)).set(...auth).send({ housekeepingStatus: 'CLEAN' });
    expect(clean.body.room.housekeepingStatus).toBe('CLEAN');

    // Setting to the same value again writes no new audit entry.
    await request(app).put(hkUrl(propertyId, `/rooms/${roomId}/condition`)).set(...auth).send({ housekeepingStatus: 'CLEAN' });

    const entries = await prisma.auditLog.findMany({
      where: { organizationId, entityType: 'room', entityId: roomId, action: 'room.housekeeping_changed' },
      orderBy: { createdAt: 'asc' },
    });
    // Two real transitions (INSPECTED→DIRTY, DIRTY→CLEAN); the repeat is a no-op.
    expect(entries).toHaveLength(2);
  });

  it('rejects an invalid condition value', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupBooking(token);
    const res = await request(app).put(hkUrl(propertyId, `/rooms/${roomId}/condition`)).set(...auth).send({ housekeepingStatus: 'SPARKLING' });
    expect(res.status).toBe(400);
  });

  it('creates, lists, and moves a task through its lifecycle', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupBooking(token);

    const created = await request(app).post(hkUrl(propertyId, '/tasks')).set(...auth).send({ roomId, type: 'STAYOVER', notes: 'Extra towels' });
    expect(created.status).toBe(201);
    const taskId = created.body.task.id as string;
    expect(created.body.task.status).toBe('PENDING');
    expect(created.body.task.type).toBe('STAYOVER');

    const list = await request(app).get(hkUrl(propertyId, '/tasks')).set(...auth);
    expect(list.body.tasks.some((t: { id: string }) => t.id === taskId)).toBe(true);
    expect(list.body.page.totalItems).toBeGreaterThanOrEqual(1);

    const started = await request(app).patch(hkUrl(propertyId, `/tasks/${taskId}`)).set(...auth).send({ status: 'IN_PROGRESS' });
    expect(started.body.task.status).toBe('IN_PROGRESS');

    const done = await request(app).patch(hkUrl(propertyId, `/tasks/${taskId}`)).set(...auth).send({ status: 'DONE' });
    expect(done.body.task.status).toBe('DONE');
    expect(done.body.task.completedAt).not.toBeNull();
  });

  it('refuses to edit a terminal task except to reopen it', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId } = await setupBooking(token);

    const created = await request(app).post(hkUrl(propertyId, '/tasks')).set(...auth).send({ roomId });
    const taskId = created.body.task.id as string;
    await request(app).patch(hkUrl(propertyId, `/tasks/${taskId}`)).set(...auth).send({ status: 'DONE' });

    // Editing notes on a done task is a conflict…
    const blocked = await request(app).patch(hkUrl(propertyId, `/tasks/${taskId}`)).set(...auth).send({ notes: 'too late' });
    expect(blocked.status).toBe(409);

    // …but reopening it is allowed, and clears completedAt.
    const reopened = await request(app).patch(hkUrl(propertyId, `/tasks/${taskId}`)).set(...auth).send({ status: 'PENDING' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.task.status).toBe('PENDING');
    expect(reopened.body.task.completedAt).toBeNull();
  });

  it('rejects a task on a room from another property (404)', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const a = await setupBooking(token);
    const b = await setupBooking(token);
    // Room from property B, posted under property A → 404 (not this property's room).
    const res = await request(app).post(hkUrl(a.propertyId, '/tasks')).set(...auth).send({ roomId: b.roomId });
    expect(res.status).toBe(404);
  });

  it('marks the room dirty and opens a DEPARTURE task on check-out', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, roomId, reservationId } = await setupBooking(token);

    // Assign, check in, then check out.
    await request(app).post(`/api/v1/properties/${propertyId}/reservations/${reservationId}/check-in`).set(...auth).send({ roomId });
    const out = await request(app).post(`/api/v1/properties/${propertyId}/reservations/${reservationId}/check-out`).set(...auth);
    expect(out.status).toBe(200);

    // The room is now DIRTY on the board…
    const board = await request(app).get(hkUrl(propertyId, '/board')).set(...auth);
    const room = board.body.board.rooms.find((r: { id: string }) => r.id === roomId);
    expect(room.housekeepingStatus).toBe('DIRTY');
    expect(room.openTasks).toBe(1);

    // …and a DEPARTURE task exists for it.
    const tasks = await request(app).get(hkUrl(propertyId, `/tasks?roomId=${roomId}`)).set(...auth);
    expect(tasks.body.tasks).toHaveLength(1);
    expect(tasks.body.tasks[0].type).toBe('DEPARTURE');
    expect(tasks.body.tasks[0].status).toBe('PENDING');

    // The checkout wrote both the reservation and housekeeping audit entries.
    const hkAudit = await prisma.auditLog.findMany({
      where: { organizationId, action: 'housekeeping_task.created' },
    });
    expect(hkAudit.length).toBeGreaterThanOrEqual(1);
  });

  it('does not leak the board or tasks across organizations', async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const { propertyId, roomId } = await setupBooking(ownerA);
    await request(app).post(hkUrl(propertyId, '/tasks')).set(...authHeader(ownerA)).send({ roomId });

    const { token: ownerB } = await loginAsNewOwner();
    // Org B can't read A's board or set A's room condition — 404 (existence hidden).
    const board = await request(app).get(hkUrl(propertyId, '/board')).set(...authHeader(ownerB));
    expect(board.status).toBe(404);
    const cond = await request(app).put(hkUrl(propertyId, `/rooms/${roomId}/condition`)).set(...authHeader(ownerB)).send({ housekeepingStatus: 'DIRTY' });
    expect(cond.status).toBe(404);
    const tasks = await request(app).get(hkUrl(propertyId, '/tasks')).set(...authHeader(ownerB));
    expect(tasks.status).toBe(404);
  });
});

/**
 * Reservation calendar / tape-chart API (read-only).
 *
 * Proves the calendar endpoint returns the locked contract: ACTIVE room types
 * with their rooms as grid rows, occupying reservations arranged as
 * window-clamped bars grouped by assigned room, and an unassigned lane for
 * bookings awaiting a room. Also covers the guards: authentication, the
 * half-open [from, to) window with its 62-night cap, cross-tenant isolation
 * (404, never another org's board), that a cancelled booking leaves the board,
 * and that a stay spilling past the window edges is clamped and flagged.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Builds a bookable property: N ACTIVE rooms of one type, a BAR rate plan
 * priced across October 2026. Returns the ids a booking needs, plus room ids. */
async function setupBookableProperty(token: string, opts: { rooms?: number; price?: number } = {}) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);

  const property = await request(app)
    .post('/api/v1/properties')
    .set(...auth)
    .send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;

  const roomType = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types`)
    .set(...auth)
    .send({ name: 'Deluxe King', code: 'DLX' });
  const roomTypeId = roomType.body.roomType.id as string;

  const roomIds: string[] = [];
  const roomCount = opts.rooms ?? 3;
  for (let i = 1; i <= roomCount; i += 1) {
    const created = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: `${100 + i}`, roomTypeId });
    expect(created.status).toBe(201);
    roomIds.push(created.body.room.id as string);
  }

  const ratePlan = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`)
    .set(...auth)
    .send({ name: 'Best Available Rate', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;

  const price = opts.price ?? 450000;
  const rates = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    amountMinor: price,
  }));
  const setRates = await request(app)
    .put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`)
    .set(...auth)
    .send({ rates });
  expect(setRates.status).toBe(200);

  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;

  return { propertyId, roomTypeId, ratePlanId, guestId, roomIds };
}

async function book(
  token: string,
  ids: { propertyId: string; guestId: string; roomTypeId: string; ratePlanId: string },
  checkIn: string,
  checkOut: string,
) {
  const res = await request(app)
    .post(`/api/v1/properties/${ids.propertyId}/reservations`)
    .set(...authHeader(token))
    .send({ guestId: ids.guestId, roomTypeId: ids.roomTypeId, ratePlanId: ids.ratePlanId, checkIn, checkOut });
  expect(res.status).toBe(201);
  return res.body.reservation.id as string;
}

async function assignRoom(token: string, propertyId: string, reservationId: string, roomId: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/reservations/${reservationId}/assign-room`)
    .set(...authHeader(token))
    .send({ roomId });
  expect(res.status).toBe(200);
}

describe('reservation calendar API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token);
    const res = await request(app).get(
      `/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-01&to=2026-10-08`,
    );
    expect(res.status).toBe(401);
  });

  it('returns room types with their rooms and the window dates', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 3 });

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-09&to=2026-10-13`)
      .set(...auth);
    expect(res.status).toBe(200);

    expect(res.body.from).toBe('2026-10-09');
    expect(res.body.to).toBe('2026-10-13');
    expect(res.body.dates).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);

    expect(res.body.roomTypes).toHaveLength(1);
    const rt = res.body.roomTypes[0];
    expect(rt).toMatchObject({ name: 'Deluxe King', code: 'DLX' });
    expect(rt.rooms).toHaveLength(3);
    expect(rt.rooms[0]).toMatchObject({ name: '101', status: 'ACTIVE', housekeepingStatus: 'INSPECTED' });
  });

  it('places an unassigned booking in the unassigned lane, not under any room', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const resvId = await book(token, ids, '2026-10-10', '2026-10-12');

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-09&to=2026-10-13`)
      .set(...auth);
    expect(res.status).toBe(200);

    expect(res.body.unassigned).toHaveLength(1);
    expect(Object.keys(res.body.assigned)).toHaveLength(0);
    const block = res.body.unassigned[0];
    expect(block).toMatchObject({
      id: resvId,
      roomId: null,
      guestName: 'Ada Lovelace',
      status: 'CONFIRMED',
      // 10-10 is column index 1 (from = 10-09), 2-night stay spans 2 columns.
      startIndex: 1,
      span: 2,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('groups an assigned booking under its room with the correct bar position', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const resvId = await book(token, ids, '2026-10-10', '2026-10-12');
    const roomId = ids.roomIds[0]!;
    await assignRoom(token, ids.propertyId, resvId, roomId);

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-09&to=2026-10-13`)
      .set(...auth);
    expect(res.status).toBe(200);

    expect(res.body.unassigned).toHaveLength(0);
    expect(res.body.assigned[roomId]).toHaveLength(1);
    expect(res.body.assigned[roomId][0]).toMatchObject({
      id: resvId,
      roomId,
      startIndex: 1,
      span: 2,
    });
  });

  it('clamps a stay that spills past both window edges and flags it', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 });
    // Stay 10-05 → 10-20 (15 nights); window is only 10-10 → 10-13 (3 nights).
    await book(token, ids, '2026-10-05', '2026-10-20');

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-10&to=2026-10-13`)
      .set(...auth);
    expect(res.status).toBe(200);

    const block = res.body.unassigned[0];
    expect(block).toMatchObject({
      startIndex: 0,
      span: 3,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  it('does not show a cancelled reservation on the board', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const resvId = await book(token, ids, '2026-10-10', '2026-10-12');

    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${resvId}/cancel`)
      .set(...auth)
      .send({ reason: 'Guest changed plans' });
    expect(cancel.status).toBe(200);

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-09&to=2026-10-13`)
      .set(...auth);
    expect(res.status).toBe(200);
    expect(res.body.unassigned).toHaveLength(0);
    expect(Object.keys(res.body.assigned)).toHaveLength(0);
  });

  it("404s for a property in another organization and never leaks its board", async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const ids = await setupBookableProperty(ownerA, { rooms: 1 });
    await book(ownerA, ids, '2026-10-10', '2026-10-12');

    // A different org's owner must not see org A's property calendar.
    const { token: ownerB } = await loginAsNewOwner();
    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-09&to=2026-10-13`)
      .set(...authHeader(ownerB));
    expect(res.status).toBe(404);
  });

  it('rejects an inverted, too-long, or incomplete window', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 });

    const tooLong = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-01&to=2026-12-05`)
      .set(...auth);
    expect(tooLong.status).toBe(400);

    const inverted = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-13&to=2026-10-10`)
      .set(...auth);
    expect(inverted.status).toBe(400);

    const missing = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/calendar?from=2026-10-10`)
      .set(...auth);
    expect(missing.status).toBe(400);
  });
});

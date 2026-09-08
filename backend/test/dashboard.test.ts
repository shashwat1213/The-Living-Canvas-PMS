/**
 * Operational dashboard API (read-only cockpit).
 *
 * Proves the per-property dashboard returns the contract the front desk's
 * daily screen needs, computed for a given date (default today): today's
 * arrivals, departures and in-house guests, occupancy, housekeeping and
 * maintenance load, and folios still carrying a balance. Also covers the
 * guards: authentication, a cross-organization property 404, and that a
 * cancelled booking and a settled folio drop off their lists.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Builds a fully-priced, bookable property: N ACTIVE rooms of one type, a
 * BAR rate plan priced across October 2026. Returns the ids a booking needs. */
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

  const guest = await request(app)
    .post('/api/v1/guests')
    .set(...auth)
    .send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;

  return { propertyId, roomTypeId, ratePlanId, guestId, roomIds };
}

async function book(
  token: string,
  ids: { propertyId: string; guestId: string; roomTypeId: string; ratePlanId: string },
  checkIn: string,
  checkOut: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/properties/${ids.propertyId}/reservations`)
    .set(...authHeader(token))
    .send({ guestId: ids.guestId, roomTypeId: ids.roomTypeId, ratePlanId: ids.ratePlanId, checkIn, checkOut });
  expect(res.status).toBe(201);
  return res.body.reservation.id as string;
}

function dashboard(token: string, propertyId: string, date?: string) {
  const qs = date ? `?date=${date}` : '';
  return request(app)
    .get(`/api/v1/properties/${propertyId}/dashboard${qs}`)
    .set(...authHeader(token));
}

describe('dashboard API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token, { rooms: 1 });
    const res = await request(app).get(`/api/v1/properties/${ids.propertyId}/dashboard`);
    expect(res.status).toBe(401);
  });

  it('defaults to today and returns the full contract shape for an empty property', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token, { rooms: 2 });

    const res = await dashboard(token, ids.propertyId);
    expect(res.status).toBe(200);

    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.date).toBe(today);
    expect(res.body.summary).toMatchObject({
      arrivals: 0,
      departures: 0,
      inHouse: 0,
      occupancyPct: 0,
      sellableRooms: 2,
      occupiedRooms: 0,
      roomsOutOfService: 0,
      openWorkOrders: 0,
      urgentWorkOrders: 0,
      unsettledFolios: 0,
      unsettledBalanceMinor: 0,
    });
    expect(res.body.arrivals).toEqual([]);
    expect(res.body.departures).toEqual([]);
    expect(res.body.inHouse).toEqual([]);
    expect(res.body.unsettledFolioList).toEqual([]);
    expect(res.body.housekeeping).toMatchObject({ openTasks: 0 });
    expect(res.body.maintenance).toMatchObject({ open: 0, urgent: 0, roomsOutOfService: 0 });
  });

  it('classifies a booking as arrival, in-house, then departure across its stay', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token, { rooms: 3 });
    // Two-night stay: 10-10 and 10-11, checkOut 10-12 (exclusive).
    const reservationId = await book(token, ids, '2026-10-10', '2026-10-12');

    // Arrival day: appears in arrivals, not yet in-house.
    const arr = await dashboard(token, ids.propertyId, '2026-10-10');
    expect(arr.status).toBe(200);
    expect(arr.body.summary.arrivals).toBe(1);
    expect(arr.body.summary.inHouse).toBe(0);
    expect(arr.body.arrivals).toHaveLength(1);
    expect(arr.body.arrivals[0]).toMatchObject({
      id: reservationId,
      status: 'CONFIRMED',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      guest: { firstName: 'Ada', lastName: 'Lovelace' },
      roomType: { name: 'Deluxe King' },
    });

    // Check the guest in (assigns a room), so it counts as in-house mid-stay.
    const checkIn = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${reservationId}/check-in`)
      .set(...authHeader(token))
      .send({ roomId: ids.roomIds[0] });
    expect(checkIn.status).toBe(200);

    // Mid-stay night: in-house, not an arrival or departure.
    const mid = await dashboard(token, ids.propertyId, '2026-10-11');
    expect(mid.body.summary.inHouse).toBe(1);
    expect(mid.body.summary.arrivals).toBe(0);
    expect(mid.body.summary.departures).toBe(0);
    expect(mid.body.inHouse).toHaveLength(1);
    expect(mid.body.inHouse[0]).toMatchObject({ id: reservationId, status: 'CHECKED_IN' });
    // Occupancy: 1 occupied of 3 sellable = 33%.
    expect(mid.body.summary.occupiedRooms).toBe(1);
    expect(mid.body.summary.sellableRooms).toBe(3);
    expect(mid.body.summary.occupancyPct).toBe(33);

    // Departure day (checkOut === date): appears in departures.
    const dep = await dashboard(token, ids.propertyId, '2026-10-12');
    expect(dep.body.summary.departures).toBe(1);
    expect(dep.body.departures).toHaveLength(1);
    expect(dep.body.departures[0]).toMatchObject({ id: reservationId, status: 'CHECKED_IN' });
  });

  it('does not count a cancelled reservation as an arrival', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const reservationId = await book(token, ids, '2026-10-10', '2026-10-12');

    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${reservationId}/cancel`)
      .set(...authHeader(token))
      .send({ reason: 'Guest changed plans' });
    expect(cancel.status).toBe(200);

    const res = await dashboard(token, ids.propertyId, '2026-10-10');
    expect(res.body.summary.arrivals).toBe(0);
    expect(res.body.arrivals).toEqual([]);
    expect(res.body.summary.occupancyPct).toBe(0);
  });

  it('lists a folio that still carries a balance and drops it once settled', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const reservationId = await book(token, ids, '2026-10-10', '2026-10-12');

    const folioBase = `/api/v1/properties/${ids.propertyId}/reservations/${reservationId}/folio`;
    // Post a charge → the folio now owes money.
    const charge = await request(app)
      .post(`${folioBase}/charges`)
      .set(...auth)
      .send({ description: 'Minibar', amountMinor: 50000 });
    expect(charge.status).toBe(201);

    // The stay itself was charged on booking (2 nights @ 4500). Read the
    // folio to learn the true outstanding balance rather than assuming it.
    const folioRes = await request(app).get(folioBase).set(...auth);
    expect(folioRes.status).toBe(200);
    const owed = folioRes.body.folio.balanceMinor as number;
    expect(owed).toBeGreaterThan(0);

    const withBalance = await dashboard(token, ids.propertyId, '2026-10-10');
    expect(withBalance.body.summary.unsettledFolios).toBe(1);
    expect(withBalance.body.summary.unsettledBalanceMinor).toBe(owed);
    expect(withBalance.body.unsettledFolioList).toHaveLength(1);
    expect(withBalance.body.unsettledFolioList[0]).toMatchObject({
      reference: withBalance.body.arrivals[0].reference,
      guestName: 'Ada Lovelace',
      balanceMinor: owed,
    });

    // Pay it off in full → it leaves the unsettled list.
    const payment = await request(app)
      .post(`${folioBase}/payments`)
      .set(...auth)
      .send({ method: 'CASH', amountMinor: owed });
    expect(payment.status).toBe(201);

    const settled = await dashboard(token, ids.propertyId, '2026-10-10');
    expect(settled.body.summary.unsettledFolios).toBe(0);
    expect(settled.body.summary.unsettledBalanceMinor).toBe(0);
    expect(settled.body.unsettledFolioList).toEqual([]);
  });

  it('rejects a malformed date', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token, { rooms: 1 });
    const res = await dashboard(token, ids.propertyId, '10-10-2026');
    expect(res.status).toBe(400);
  });
});

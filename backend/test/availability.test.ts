/**
 * Availability API (read-only inventory grid).
 *
 * Proves the availability endpoint returns the locked contract: an ACTIVE
 * room-type-by-night grid of booked/available counts derived from occupying
 * reservations, plus rolled-up totals with occupancy. Also covers the guards:
 * authentication, the half-open [from, to) window, the 62-night cap, that a
 * cancelled booking frees inventory, and that occupancy is computed correctly.
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

  const roomCount = opts.rooms ?? 3;
  for (let i = 1; i <= roomCount; i += 1) {
    const created = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: `${100 + i}`, roomTypeId });
    expect(created.status).toBe(201);
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

  return { propertyId, roomTypeId, ratePlanId, guestId };
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

/** Pulls a single room type's day out of a grid response by date. */
function dayOf(roomType: { days: { date: string; booked: number; available: number }[] }, date: string) {
  const day = roomType.days.find((d) => d.date === date);
  if (!day) throw new Error(`no day ${date} in grid`);
  return day;
}

function totalDayOf(body: { totals: { days: { date: string }[] } }, date: string) {
  const day = body.totals.days.find((d) => d.date === date);
  if (!day) throw new Error(`no totals day ${date}`);
  return day as { date: string; totalRooms: number; booked: number; available: number; occupancyPct: number };
}

describe('availability API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token);
    const res = await request(app).get(
      `/api/v1/properties/${ids.propertyId}/availability?from=2026-10-01&to=2026-10-08`,
    );
    expect(res.status).toBe(401);
  });

  it('shows booked=1/available=N-1 on booked nights and booked=0 on unbooked nights', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const N = 3;
    const ids = await setupBookableProperty(token, { rooms: N });

    // One booking, 2 nights: 10-10 and 10-11 (checkOut 10-12 is exclusive).
    await book(token, ids, '2026-10-10', '2026-10-12');

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-09&to=2026-10-13`)
      .set(...auth);
    expect(res.status).toBe(200);

    // Window contract: from inclusive, to exclusive.
    expect(res.body.from).toBe('2026-10-09');
    expect(res.body.to).toBe('2026-10-13');
    expect(res.body.dates).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);

    expect(res.body.roomTypes).toHaveLength(1);
    const rt = res.body.roomTypes[0];
    expect(rt).toMatchObject({ name: 'Deluxe King', code: 'DLX', totalRooms: N });

    // Unbooked nights: booked 0, available N.
    expect(dayOf(rt, '2026-10-09')).toMatchObject({ booked: 0, available: N });
    expect(dayOf(rt, '2026-10-12')).toMatchObject({ booked: 0, available: N });
    // Booked nights: booked 1, available N-1.
    expect(dayOf(rt, '2026-10-10')).toMatchObject({ booked: 1, available: N - 1 });
    expect(dayOf(rt, '2026-10-11')).toMatchObject({ booked: 1, available: N - 1 });
  });

  it('computes occupancyPct correctly in the totals', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    // 4 rooms, 1 booking on 10-10 → 1/4 = 25%.
    const ids = await setupBookableProperty(token, { rooms: 4 });
    await book(token, ids, '2026-10-10', '2026-10-11');

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-10&to=2026-10-12`)
      .set(...auth);
    expect(res.status).toBe(200);

    const booked = totalDayOf(res.body, '2026-10-10');
    expect(booked).toMatchObject({ totalRooms: 4, booked: 1, available: 3, occupancyPct: 25 });
    const free = totalDayOf(res.body, '2026-10-11');
    expect(free).toMatchObject({ totalRooms: 4, booked: 0, available: 4, occupancyPct: 0 });
  });

  it('does not count a cancelled reservation as booked', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const id = await book(token, ids, '2026-10-10', '2026-10-12');

    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/cancel`)
      .set(...auth)
      .send({ reason: 'Guest changed plans' });
    expect(cancel.status).toBe(200);

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-10&to=2026-10-12`)
      .set(...auth);
    expect(res.status).toBe(200);

    const rt = res.body.roomTypes[0];
    expect(dayOf(rt, '2026-10-10')).toMatchObject({ booked: 0, available: 2 });
    expect(dayOf(rt, '2026-10-11')).toMatchObject({ booked: 0, available: 2 });
    expect(totalDayOf(res.body, '2026-10-10')).toMatchObject({ booked: 0, occupancyPct: 0 });
  });

  it('rejects a window that is too long or inverted', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 });

    // Span > 62 nights.
    const tooLong = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-01&to=2026-12-05`)
      .set(...auth);
    expect(tooLong.status).toBe(400);

    // to <= from (equal).
    const equal = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-10&to=2026-10-10`)
      .set(...auth);
    expect(equal.status).toBe(400);

    // to < from.
    const inverted = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-13&to=2026-10-10`)
      .set(...auth);
    expect(inverted.status).toBe(400);

    // Missing params.
    const missing = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-10`)
      .set(...auth);
    expect(missing.status).toBe(400);
  });

  it('accepts a window of exactly 62 nights', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 });

    // 2026-10-01 → 2026-12-02 is exactly 62 nights.
    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/availability?from=2026-10-01&to=2026-12-02`)
      .set(...auth);
    expect(res.status).toBe(200);
    expect(res.body.dates).toHaveLength(62);
  });
});

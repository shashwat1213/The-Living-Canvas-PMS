/**
 * Reports API — revenue & occupancy (read-only management analytics).
 *
 * Proves the revenue report computes the industry-standard metrics from the
 * authoritative per-night ledger: room revenue (accrual, per stay night),
 * occupancy, ADR and RevPAR, plus payments collected (cash basis, by method).
 * Also covers the guards: authentication, the half-open [from, to) window and
 * its year cap, that a cancelled booking earns nothing, and that STAFF is
 * refused while a manager is allowed.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

const NIGHTLY = 450000; // ₹4,500.00 per night in paise

async function setupBookableProperty(token: string, opts: { rooms?: number } = {}) {
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

  const roomCount = opts.rooms ?? 4;
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

  const rates = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    amountMinor: NIGHTLY,
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

  return { propertyId, roomTypeId, ratePlanId, guestId };
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

function report(token: string, propertyId: string, from: string, to: string) {
  return request(app)
    .get(`/api/v1/properties/${propertyId}/reports/revenue?from=${from}&to=${to}`)
    .set(...authHeader(token));
}

function dayOf(body: { days: { date: string }[] }, date: string) {
  const day = body.days.find((d) => d.date === date);
  if (!day) throw new Error(`no report day ${date}`);
  return day as {
    date: string;
    roomRevenueMinor: number;
    roomsSold: number;
    roomsAvailable: number;
    occupancyPct: number;
    adrMinor: number;
    revparMinor: number;
  };
}

describe('reports API — revenue & occupancy', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token);
    const res = await request(app).get(
      `/api/v1/properties/${ids.propertyId}/reports/revenue?from=2026-10-10&to=2026-10-12`,
    );
    expect(res.status).toBe(401);
  });

  it('computes room revenue, occupancy, ADR and RevPAR per night and in summary', async () => {
    const { token } = await loginAsNewOwner();
    const N = 4;
    const ids = await setupBookableProperty(token, { rooms: N });

    // One 2-night booking: nights 10-10 and 10-11 (checkOut 10-12 exclusive).
    await book(token, ids, '2026-10-10', '2026-10-12');

    // Window 10-10 .. 10-13 (exclusive) = 3 nights: two booked, one empty.
    const res = await report(token, ids.propertyId, '2026-10-10', '2026-10-13');
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('2026-10-10');
    expect(res.body.to).toBe('2026-10-13');
    expect(res.body.nights).toBe(3);
    expect(res.body.sellableRooms).toBe(N);
    expect(res.body.days).toHaveLength(3);

    // A booked night: 1 room sold of 4, revenue one night's rate.
    const booked = dayOf(res.body, '2026-10-10');
    expect(booked.roomRevenueMinor).toBe(NIGHTLY);
    expect(booked.roomsSold).toBe(1);
    expect(booked.roomsAvailable).toBe(N);
    expect(booked.occupancyPct).toBe(25); // 1/4
    expect(booked.adrMinor).toBe(NIGHTLY); // revenue / rooms sold
    expect(booked.revparMinor).toBe(Math.round(NIGHTLY / N)); // revenue / rooms available

    // The empty night: zero-filled, not missing.
    const empty = dayOf(res.body, '2026-10-12');
    expect(empty.roomRevenueMinor).toBe(0);
    expect(empty.roomsSold).toBe(0);
    expect(empty.occupancyPct).toBe(0);
    expect(empty.adrMinor).toBe(0); // no divide-by-zero
    expect(empty.revparMinor).toBe(0);

    // Summary across 3 nights: 2 room-nights sold of 12 available.
    expect(res.body.summary.roomRevenueMinor).toBe(2 * NIGHTLY);
    expect(res.body.summary.roomsSold).toBe(2);
    expect(res.body.summary.roomNightsAvailable).toBe(N * 3);
    expect(res.body.summary.occupancyPct).toBe(Math.round((2 / (N * 3)) * 100)); // 2/12 = 17%
    expect(res.body.summary.adrMinor).toBe(NIGHTLY); // 2*rate / 2 sold
    expect(res.body.summary.revparMinor).toBe(Math.round((2 * NIGHTLY) / (N * 3)));
  });

  it('does not count a cancelled reservation as revenue or occupancy', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const id = await book(token, ids, '2026-10-10', '2026-10-12');

    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/cancel`)
      .set(...auth)
      .send({ reason: 'Guest changed plans' });
    expect(cancel.status).toBe(200);

    const res = await report(token, ids.propertyId, '2026-10-10', '2026-10-12');
    expect(res.body.summary.roomRevenueMinor).toBe(0);
    expect(res.body.summary.roomsSold).toBe(0);
    expect(res.body.summary.occupancyPct).toBe(0);
  });

  it('reports payments collected in the window, grouped by method', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });
    const reservationId = await book(token, ids, '2026-10-10', '2026-10-12');

    const folioBase = `/api/v1/properties/${ids.propertyId}/reservations/${reservationId}/folio`;
    const cash = await request(app).post(`${folioBase}/payments`).set(...auth).send({ method: 'CASH', amountMinor: 300000 });
    expect(cash.status).toBe(201);
    const card = await request(app).post(`${folioBase}/payments`).set(...auth).send({ method: 'CARD', amountMinor: 500000 });
    expect(card.status).toBe(201);

    // Payments are cash-basis on createdAt (today), so a wide window catches them.
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await report(token, ids.propertyId, today, to);
    expect(res.status).toBe(200);

    expect(res.body.summary.paymentsCollectedMinor).toBe(800000);
    // Sorted by amount desc: CARD (5000) before CASH (3000).
    expect(res.body.paymentsByMethod.map((m: { method: string }) => m.method)).toEqual(['CARD', 'CASH']);
    const card2 = res.body.paymentsByMethod.find((m: { method: string }) => m.method === 'CARD');
    expect(card2).toMatchObject({ amountMinor: 500000, count: 1 });
  });

  it('rejects an inverted or too-long window', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 });

    const inverted = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reports/revenue?from=2026-10-13&to=2026-10-10`)
      .set(...auth);
    expect(inverted.status).toBe(400);

    const equal = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reports/revenue?from=2026-10-10&to=2026-10-10`)
      .set(...auth);
    expect(equal.status).toBe(400);

    // > 366 nights.
    const tooLong = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reports/revenue?from=2026-01-01&to=2027-06-01`)
      .set(...auth);
    expect(tooLong.status).toBe(400);

    const missing = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reports/revenue?from=2026-10-10`)
      .set(...auth);
    expect(missing.status).toBe(400);
  });

  it('allows a manager but refuses a staff member (reports are management-only)', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });

    // Provision a MANAGER and a STAFF, both granted this property.
    const password = 'correct-horse-battery-staple';
    const mgr = await request(app)
      .post('/api/v1/staff')
      .set(...auth)
      .send({
        email: `mgr-${randomUUID().slice(0, 8)}@x.com`,
        password,
        firstName: 'Meg',
        lastName: 'Manager',
        role: 'MANAGER',
        propertyIds: [ids.propertyId],
      });
    expect(mgr.status).toBe(201);
    const stf = await request(app)
      .post('/api/v1/staff')
      .set(...auth)
      .send({
        email: `stf-${randomUUID().slice(0, 8)}@x.com`,
        password,
        firstName: 'Sam',
        lastName: 'Staff',
        role: 'STAFF',
        propertyIds: [ids.propertyId],
      });
    expect(stf.status).toBe(201);

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: mgr.body.staff.email, password });
    const stfLogin = await request(app).post('/api/v1/auth/login').send({ email: stf.body.staff.email, password });
    expect(mgrLogin.status).toBe(200);
    expect(stfLogin.status).toBe(200);
    expect(organizationId).toBeTruthy();

    const asMgr = await report(mgrLogin.body.accessToken, ids.propertyId, '2026-10-10', '2026-10-12');
    expect(asMgr.status).toBe(200);

    const asStaff = await report(stfLogin.body.accessToken, ids.propertyId, '2026-10-10', '2026-10-12');
    expect(asStaff.status).toBe(403);
  });
});

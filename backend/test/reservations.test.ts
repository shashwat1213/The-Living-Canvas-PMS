/**
 * Reservations API (Phase 2 — booking core, Slice B).
 *
 * The heart of the PMS: this suite proves a booking can be made end to end —
 * priced from the rate plan, checked against availability, snapshotted — and
 * then cancelled or marked a no-show. Also covers the guards that make it
 * trustworthy: no availability, unpriced nights, cross-property references,
 * permission gating, and the audit trail.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Builds a fully-priced, bookable property: 2 ACTIVE rooms of one type,
 * a BAR rate plan priced across a date range. Returns the ids a booking needs. */
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
    .send({ name: 'Deluxe King' });
  const roomTypeId = roomType.body.roomType.id as string;

  const roomCount = opts.rooms ?? 2;
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

  // Price October 2026 at ₹4,500/night.
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

function bookingBody(ids: { guestId: string; roomTypeId: string; ratePlanId: string }, over: Record<string, unknown> = {}) {
  return {
    guestId: ids.guestId,
    roomTypeId: ids.roomTypeId,
    ratePlanId: ids.ratePlanId,
    checkIn: '2026-10-10',
    checkOut: '2026-10-13',
    ...over,
  };
}

describe('reservations API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token);
    const res = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservations`);
    expect(res.status).toBe(401);
  });

  it('creates a booking priced from the rate plan, with a per-night snapshot', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    const res = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids));

    expect(res.status).toBe(201);
    const r = res.body.reservation;
    expect(r.status).toBe('CONFIRMED');
    expect(r.reference).toMatch(/^LC-[A-Z0-9]{6}$/);
    // 3 nights × ₹4,500 = ₹13,500.
    expect(r.totalAmountMinor).toBe(3 * 450000);
    expect(r.nights).toHaveLength(3);
    expect(r.nights.map((n: { date: string }) => n.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(r.guest.firstName).toBe('Ada');
    expect(r.roomType.name).toBe('Deluxe King');
    expect(r.ratePlan.code).toBe('BAR');
  });

  it('quotes availability and price without writing anything', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    const quote = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/quote`)
      .set(...auth)
      .send(bookingBody(ids));
    expect(quote.status).toBe(200);
    expect(quote.body).toMatchObject({ available: true, sellableRooms: 2, booked: 0, nights: 3, totalMinor: 1350000 });

    // Nothing was created.
    const list = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservations`).set(...auth);
    expect(list.body.reservations).toHaveLength(0);
  });

  it('refuses a booking when every room of the type is taken for the dates', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 }); // only one room

    const first = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids));
    expect(first.status).toBe(201);

    // A second, overlapping booking has no room to take.
    const second = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-10-11', checkOut: '2026-10-14' }));
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('No availability');

    // A non-overlapping booking (after the first checks out) still works.
    const later = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-10-13', checkOut: '2026-10-15' }));
    expect(later.status).toBe(201);
  });

  it('refuses a booking whose stay has an unpriced night', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    // November is not priced (only October was).
    const res = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-11-01', checkOut: '2026-11-03' }));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('no price set');
  });

  it('validates the stay window', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    const sameDay = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-10-10', checkOut: '2026-10-10' }));
    expect(sameDay.status).toBe(400);

    const inverted = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-10-13', checkOut: '2026-10-10' }));
    expect(inverted.status).toBe(400);
  });

  it('rejects a rate plan that belongs to a different room type', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    // A second room type with its own plan.
    const otherType = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/room-types`)
      .set(...auth)
      .send({ name: 'Suite' });
    const otherTypeId = otherType.body.roomType.id as string;
    const otherPlan = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/room-types/${otherTypeId}/rate-plans`)
      .set(...auth)
      .send({ name: 'Suite BAR' });

    const res = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { ratePlanId: otherPlan.body.ratePlan.id }));
    expect(res.status).toBe(404);
  });

  it('cancels a confirmed booking and frees the room, then blocks a re-cancel', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 1 });

    const booking = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids));
    const id = booking.body.reservation.id as string;

    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/cancel`)
      .set(...auth)
      .send({ reason: 'Guest changed plans' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.reservation.status).toBe('CANCELLED');
    expect(cancel.body.reservation.cancelReason).toBe('Guest changed plans');

    // Re-cancelling is a conflict, not a silent success.
    const again = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/cancel`)
      .set(...auth)
      .send({});
    expect(again.status).toBe(409);

    // The room is free again: a new overlapping booking now succeeds.
    const rebook = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids));
    expect(rebook.status).toBe(201);
  });

  it('marks a confirmed booking a no-show, but refuses it once cancelled', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    const booking = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids));
    const id = booking.body.reservation.id as string;

    const noShow = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/no-show`)
      .set(...auth);
    expect(noShow.status).toBe(200);
    expect(noShow.body.reservation.status).toBe('NO_SHOW');

    // Cancelling a no-show is refused.
    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/cancel`)
      .set(...auth)
      .send({});
    expect(cancel.status).toBe(409);
  });

  it('filters the list by status and by an overlapping date window', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 5 });

    const oct = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-10-05', checkOut: '2026-10-07' }));
    const octId = oct.body.reservation.id as string;
    await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids, { checkIn: '2026-10-20', checkOut: '2026-10-22' }));

    // Window overlapping only the first booking.
    const windowed = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservations?from=2026-10-01&to=2026-10-10`)
      .set(...auth);
    expect(windowed.body.reservations).toHaveLength(1);
    expect(windowed.body.reservations[0].id).toBe(octId);

    await request(app).post(`/api/v1/properties/${ids.propertyId}/reservations/${octId}/cancel`).set(...auth).send({});
    const confirmed = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservations?status=CONFIRMED`)
      .set(...auth);
    expect(confirmed.body.reservations.every((r: { status: string }) => r.status === 'CONFIRMED')).toBe(true);
    const cancelled = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservations?status=CANCELLED`)
      .set(...auth);
    expect(cancelled.body.reservations).toHaveLength(1);
  });

  it('writes audit entries for a booking and its cancellation', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token);

    const booking = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send(bookingBody(ids));
    const id = booking.body.reservation.id as string;
    await request(app).post(`/api/v1/properties/${ids.propertyId}/reservations/${id}/cancel`).set(...auth).send({ reason: 'test' });

    const entries = await prisma.auditLog.findMany({
      where: { organizationId, entityType: 'reservation', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action)).toEqual(['reservation.created', 'reservation.cancelled']);
  });
});

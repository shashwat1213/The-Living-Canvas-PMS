/**
 * Folios & payments API (Phase 2 — billing).
 *
 * Proves the guest-bill flow end to end: a folio opens with the reservation's
 * room charge, extra charges and payments post to it, the balance is derived
 * (never stored) from those lines, and a folio can only be closed when settled.
 * Also covers the guards that make it trustworthy: closed-folio posting,
 * cross-tenant isolation, permission gating, and the audit trail.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Builds a bookable property and one confirmed booking; returns the ids. */
async function setupBooking(token: string, opts: { price?: number } = {}) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);

  const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;

  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe King' });
  const roomTypeId = roomType.body.roomType.id as string;

  await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: '101', roomTypeId });

  const ratePlan = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`)
    .set(...auth)
    .send({ name: 'Best Available Rate', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;

  const price = opts.price ?? 450000;
  const rates = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amountMinor: price }));
  await request(app).put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`).set(...auth).send({ rates });

  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;

  const booking = await request(app)
    .post(`/api/v1/properties/${propertyId}/reservations`)
    .set(...auth)
    .send({ guestId, roomTypeId, ratePlanId, checkIn: '2026-10-01', checkOut: '2026-10-03' }); // 2 nights
  const reservationId = booking.body.reservation.id as string;

  return { propertyId, reservationId, nightlyTotal: 2 * price };
}

function folioUrl(propertyId: string, reservationId: string, sub = ''): string {
  return `/api/v1/properties/${propertyId}/reservations/${reservationId}/folio${sub}`;
}

describe('folios & payments API', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const { propertyId, reservationId } = await setupBooking(token);
    const res = await request(app).get(folioUrl(propertyId, reservationId));
    expect(res.status).toBe(401);
  });

  it('opens a folio on first view with the room charge, and derives the balance', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId, nightlyTotal } = await setupBooking(token);

    const res = await request(app).get(folioUrl(propertyId, reservationId)).set(...auth);
    expect(res.status).toBe(200);
    const f = res.body.folio;
    expect(f.status).toBe('OPEN');
    expect(f.charges).toHaveLength(1);
    expect(f.charges[0].amountMinor).toBe(nightlyTotal);
    expect(f.chargesTotalMinor).toBe(nightlyTotal);
    expect(f.paymentsTotalMinor).toBe(0);
    // Balance = charges - payments, derived, positive (guest owes the room).
    expect(f.balanceMinor).toBe(nightlyTotal);
  });

  it('is idempotent on open — a second view does not add a second room charge', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId } = await setupBooking(token);

    const first = await request(app).get(folioUrl(propertyId, reservationId)).set(...auth);
    const second = await request(app).get(folioUrl(propertyId, reservationId)).set(...auth);
    expect(second.body.folio.id).toBe(first.body.folio.id);
    expect(second.body.folio.charges).toHaveLength(1);
  });

  it('posts an extra charge and a payment, and tracks the running balance to zero', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId, nightlyTotal } = await setupBooking(token);

    const charge = await request(app).post(folioUrl(propertyId, reservationId, '/charges')).set(...auth).send({ description: 'Minibar', amountMinor: 50000 });
    expect(charge.status).toBe(201);
    expect(charge.body.folio.chargesTotalMinor).toBe(nightlyTotal + 50000);
    expect(charge.body.folio.balanceMinor).toBe(nightlyTotal + 50000);

    const owed = nightlyTotal + 50000;
    const pay = await request(app).post(folioUrl(propertyId, reservationId, '/payments')).set(...auth).send({ method: 'CARD', amountMinor: owed, reference: 'AUTH123' });
    expect(pay.status).toBe(201);
    expect(pay.body.folio.paymentsTotalMinor).toBe(owed);
    expect(pay.body.folio.balanceMinor).toBe(0);
    expect(pay.body.folio.payments[0].method).toBe('CARD');
    expect(pay.body.folio.payments[0].reference).toBe('AUTH123');
  });

  it('refuses to close a folio with an outstanding balance, then closes it once settled', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId, nightlyTotal } = await setupBooking(token);

    // Open then try to close while unpaid.
    await request(app).get(folioUrl(propertyId, reservationId)).set(...auth);
    const early = await request(app).post(folioUrl(propertyId, reservationId, '/close')).set(...auth);
    expect(early.status).toBe(400);
    expect(early.body.error.message).toContain('outstanding balance');

    await request(app).post(folioUrl(propertyId, reservationId, '/payments')).set(...auth).send({ method: 'CASH', amountMinor: nightlyTotal });
    const close = await request(app).post(folioUrl(propertyId, reservationId, '/close')).set(...auth);
    expect(close.status).toBe(200);
    expect(close.body.folio.status).toBe('CLOSED');
    expect(close.body.folio.closedAt).not.toBeNull();
  });

  it('refuses a charge on a closed folio until it is reopened', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId, nightlyTotal } = await setupBooking(token);

    await request(app).post(folioUrl(propertyId, reservationId, '/payments')).set(...auth).send({ method: 'CASH', amountMinor: nightlyTotal });
    await request(app).post(folioUrl(propertyId, reservationId, '/close')).set(...auth);

    const blocked = await request(app).post(folioUrl(propertyId, reservationId, '/charges')).set(...auth).send({ description: 'Late fee', amountMinor: 10000 });
    expect(blocked.status).toBe(409);

    const reopen = await request(app).post(folioUrl(propertyId, reservationId, '/reopen')).set(...auth);
    expect(reopen.status).toBe(200);
    expect(reopen.body.folio.status).toBe('OPEN');

    const ok = await request(app).post(folioUrl(propertyId, reservationId, '/charges')).set(...auth).send({ description: 'Late fee', amountMinor: 10000 });
    expect(ok.status).toBe(201);
    // New balance is the late fee (was settled at zero, now +10000 owed).
    expect(ok.body.folio.balanceMinor).toBe(10000);
  });

  it('validates charge and payment input', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId } = await setupBooking(token);

    const zeroCharge = await request(app).post(folioUrl(propertyId, reservationId, '/charges')).set(...auth).send({ description: 'X', amountMinor: 0 });
    expect(zeroCharge.status).toBe(400);
    const noDesc = await request(app).post(folioUrl(propertyId, reservationId, '/charges')).set(...auth).send({ description: '', amountMinor: 100 });
    expect(noDesc.status).toBe(400);
    const badMethod = await request(app).post(folioUrl(propertyId, reservationId, '/payments')).set(...auth).send({ method: 'BITCOIN', amountMinor: 100 });
    expect(badMethod.status).toBe(400);
  });

  it('writes an audit trail for open, charge, payment and close', async () => {
    const { token, organizationId } = await loginAsNewOwner();
    const auth = authHeader(token);
    const { propertyId, reservationId, nightlyTotal } = await setupBooking(token);

    const opened = await request(app).get(folioUrl(propertyId, reservationId)).set(...auth);
    const folioId = opened.body.folio.id as string;
    await request(app).post(folioUrl(propertyId, reservationId, '/charges')).set(...auth).send({ description: 'Spa', amountMinor: 20000 });
    await request(app).post(folioUrl(propertyId, reservationId, '/payments')).set(...auth).send({ method: 'UPI', amountMinor: nightlyTotal + 20000 });
    await request(app).post(folioUrl(propertyId, reservationId, '/close')).set(...auth);

    const entries = await prisma.auditLog.findMany({
      where: { organizationId, entityType: 'folio', entityId: folioId },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.action)).toEqual([
      'folio.opened',
      'folio.charge_added',
      'folio.payment_recorded',
      'folio.closed',
    ]);
  });

  it('does not leak a folio across organizations', async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const { propertyId, reservationId } = await setupBooking(ownerA);
    // Open it as A.
    await request(app).get(folioUrl(propertyId, reservationId)).set(...authHeader(ownerA));

    // Org B cannot see A's property/reservation/folio — 404 (existence hidden).
    const { token: ownerB } = await loginAsNewOwner();
    const cross = await request(app).get(folioUrl(propertyId, reservationId)).set(...authHeader(ownerB));
    expect(cross.status).toBe(404);
    const crossPay = await request(app).post(folioUrl(propertyId, reservationId, '/payments')).set(...authHeader(ownerB)).send({ method: 'CASH', amountMinor: 100 });
    expect(crossPay.status).toBe(404);
  });
});

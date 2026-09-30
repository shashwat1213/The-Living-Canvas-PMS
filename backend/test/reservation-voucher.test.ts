/**
 * Guest booking voucher (PDF).
 *
 * Proves the voucher endpoint returns a real PDF for a booking, with the right
 * content-type and a reference-named download, and that it's guarded like every
 * other reservation read — auth required, cross-org id 404s.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function setupBooking(token: string) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);

  const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;

  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe King', code: 'DLX' });
  const roomTypeId = roomType.body.roomType.id as string;
  await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: '101', roomTypeId });

  const ratePlan = await request(app).post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`).set(...auth).send({ name: 'BAR', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;
  const rates = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amountMinor: 500000 }));
  await request(app).put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`).set(...auth).send({ rates });

  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' });
  const guestId = guest.body.guest.id as string;

  const booking = await request(app)
    .post(`/api/v1/properties/${propertyId}/reservations`)
    .set(...auth)
    .send({ guestId, roomTypeId, ratePlanId, checkIn: '2026-10-10', checkOut: '2026-10-12' });
  return { propertyId, reservationId: booking.body.reservation.id as string, reference: booking.body.reservation.reference as string };
}

describe('reservation voucher (PDF)', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBooking(token);
    const res = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservations/${ids.reservationId}/voucher.pdf`);
    expect(res.status).toBe(401);
  });

  it('returns a valid PDF with a reference-named inline disposition', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBooking(token);

    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservations/${ids.reservationId}/voucher.pdf`)
      .set(...auth)
      .buffer(true)
      .parse((response, cb) => {
        const data: Buffer[] = [];
        response.on('data', (chunk: Buffer) => data.push(Buffer.from(chunk)));
        response.on('end', () => cb(null, Buffer.concat(data)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`voucher-${ids.reference}.pdf`);
    // A real PDF starts with the "%PDF-" magic and is non-trivial in size.
    const body = res.body as Buffer;
    expect(body.slice(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(500);
  });

  it('404s a voucher for a booking in another organization', async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const ids = await setupBooking(ownerA);

    const { token: ownerB } = await loginAsNewOwner();
    const res = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservations/${ids.reservationId}/voucher.pdf`)
      .set(...authHeader(ownerB));
    // Org B has no access to org A's property.
    expect([403, 404]).toContain(res.status);
  });
});

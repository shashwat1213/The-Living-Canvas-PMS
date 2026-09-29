/**
 * Online payments through the payment-gateway seam (`platform/payments`).
 *
 * Proves the full intent flow against the deterministic stub provider: open an
 * intent → verify a correctly-signed return → a CARD payment posts to the folio
 * and the intent goes PAID. Also covers the security property (a bad signature
 * fails and posts nothing), no double-capture, closed-folio guard, and tenant
 * isolation.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';
import { signStubReturn, stubPaymentId } from '../src/platform/payments/stub-provider.js';
import { resetPaymentProvider } from '../src/platform/payments/registry.js';

afterEach(() => {
  resetPaymentProvider();
});

/** A property with one bookable room, a priced plan, a guest, and a booking. */
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

  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;

  // 2 nights @ 5000 = 10000 total.
  const booking = await request(app)
    .post(`/api/v1/properties/${propertyId}/reservations`)
    .set(...auth)
    .send({ guestId, roomTypeId, ratePlanId, checkIn: '2026-10-10', checkOut: '2026-10-12' });
  const reservationId = booking.body.reservation.id as string;

  return { propertyId, reservationId };
}

const folioBase = (propertyId: string, reservationId: string) =>
  `/api/v1/properties/${propertyId}/reservations/${reservationId}/folio`;

describe('online payments (payment-intent seam)', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBooking(token);
    const res = await request(app).post(`${folioBase(ids.propertyId, ids.reservationId)}/payment-intents`).send({ amountMinor: 1000000 });
    expect(res.status).toBe(401);
  });

  it('opens an intent, verifies a signed return, and posts the payment to the folio', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBooking(token);
    const base = folioBase(ids.propertyId, ids.reservationId);

    // The folio opens with the 10000 room charge → balance 1,000,000 paise.
    const folio = await request(app).get(base).set(...auth);
    expect(folio.body.folio.balanceMinor).toBe(1000000);

    // Open an intent for the full balance.
    const created = await request(app).post(`${base}/payment-intents`).set(...auth).send({ amountMinor: 1000000 });
    expect(created.status).toBe(201);
    expect(created.body.intent).toMatchObject({ status: 'CREATED', provider: 'stub', amountMinor: 1000000 });
    const intentId = created.body.intent.id as string;
    const orderId = created.body.intent.gatewayOrderId as string;
    expect(orderId).toBeTruthy();

    // Simulate the client checkout: a gateway payment id + a valid signature.
    const gatewayPaymentId = stubPaymentId();
    const signature = signStubReturn(orderId, gatewayPaymentId);
    const verified = await request(app)
      .post(`${base}/payment-intents/${intentId}/verify`)
      .set(...auth)
      .send({ gatewayPaymentId, signature });
    expect(verified.status).toBe(200);
    expect(verified.body.intent).toMatchObject({ status: 'PAID', gatewayPaymentId });

    // The folio now shows a CARD payment for the full amount → balance zero.
    const after = await request(app).get(base).set(...auth);
    expect(after.body.folio.paymentsTotalMinor).toBe(1000000);
    expect(after.body.folio.balanceMinor).toBe(0);
    const cardPayments = after.body.folio.payments.filter((p: { method: string }) => p.method === 'CARD');
    expect(cardPayments).toHaveLength(1);
    expect(cardPayments[0].reference).toBe(gatewayPaymentId);
  });

  it('rejects a tampered signature and posts nothing', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBooking(token);
    const base = folioBase(ids.propertyId, ids.reservationId);

    const created = await request(app).post(`${base}/payment-intents`).set(...auth).send({ amountMinor: 500000 });
    const intentId = created.body.intent.id as string;

    const bad = await request(app)
      .post(`${base}/payment-intents/${intentId}/verify`)
      .set(...auth)
      .send({ gatewayPaymentId: stubPaymentId(), signature: 'deadbeef-not-a-valid-signature' });
    expect(bad.status).toBe(400);

    // Nothing posted; the intent is FAILED.
    const folio = await request(app).get(base).set(...auth);
    expect(folio.body.folio.paymentsTotalMinor).toBe(0);
    const intents = await request(app).get(`${base}/payment-intents`).set(...auth);
    expect(intents.body.intents[0]).toMatchObject({ status: 'FAILED' });
  });

  it('does not let the same intent be captured twice', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBooking(token);
    const base = folioBase(ids.propertyId, ids.reservationId);

    const created = await request(app).post(`${base}/payment-intents`).set(...auth).send({ amountMinor: 500000 });
    const intentId = created.body.intent.id as string;
    const orderId = created.body.intent.gatewayOrderId as string;
    const gatewayPaymentId = stubPaymentId();
    const signature = signStubReturn(orderId, gatewayPaymentId);

    const first = await request(app).post(`${base}/payment-intents/${intentId}/verify`).set(...auth).send({ gatewayPaymentId, signature });
    expect(first.status).toBe(200);

    const second = await request(app).post(`${base}/payment-intents/${intentId}/verify`).set(...auth).send({ gatewayPaymentId, signature });
    expect(second.status).toBe(409);

    // Still only one payment on the folio.
    const folio = await request(app).get(base).set(...auth);
    expect(folio.body.folio.paymentsTotalMinor).toBe(500000);
  });

  it('404s an intent (and its verify) for a folio in another organization', async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const idsA = await setupBooking(ownerA);
    const baseA = folioBase(idsA.propertyId, idsA.reservationId);
    const created = await request(app).post(`${baseA}/payment-intents`).set(...authHeader(ownerA)).send({ amountMinor: 500000 });
    const intentId = created.body.intent.id as string;
    const orderId = created.body.intent.gatewayOrderId as string;

    const { token: ownerB } = await loginAsNewOwner();
    const leak = await request(app)
      .post(`${baseA}/payment-intents/${intentId}/verify`)
      .set(...authHeader(ownerB))
      .send({ gatewayPaymentId: stubPaymentId(), signature: signStubReturn(orderId, 'x') });
    // Org B fails requirePropertyAccess on org A's property.
    expect([403, 404]).toContain(leak.status);
  });

  it('rejects opening an intent on a closed folio', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBooking(token);
    const base = folioBase(ids.propertyId, ids.reservationId);

    // Pay the balance manually, then close the folio.
    await request(app).post(`${base}/payments`).set(...auth).send({ method: 'CASH', amountMinor: 1000000 });
    const closed = await request(app).post(`${base}/close`).set(...auth);
    expect(closed.status).toBe(200);

    const res = await request(app).post(`${base}/payment-intents`).set(...auth).send({ amountMinor: 100000 });
    expect(res.status).toBe(409);
  });
});

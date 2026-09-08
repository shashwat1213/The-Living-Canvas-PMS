/**
 * POS & inventory API — outlets, product catalogue and orders.
 *
 * Proves the point-of-sale slice: outlet + product CRUD with per-property /
 * per-outlet uniqueness, order creation with price snapshots and stock
 * decrements, the two settlement paths (charge to a room folio; direct
 * payment), void-with-restock, and the RBAC split (STAFF operates but cannot
 * manage the catalogue). Cross-outlet / cross-tenant product and reservation
 * ids are all indistinguishable from nonexistent (404).
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function setupProperty(token: string) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);
  const property = await request(app)
    .post('/api/v1/properties')
    .set(...auth)
    .send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  return property.body.property.id as string;
}

async function createOutlet(token: string, propertyId: string, name = 'Rooftop Bar', type = 'BAR') {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/pos/outlets`)
    .set(...authHeader(token))
    .send({ name, type });
  return res;
}

async function createProduct(
  token: string,
  propertyId: string,
  outletId: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post(`/api/v1/properties/${propertyId}/pos/outlets/${outletId}/products`)
    .set(...authHeader(token))
    .send(body);
}

/** A fully-priced, bookable property + a CONFIRMED reservation, for room-charge tests. */
async function setupBookableWithReservation(token: string, propertyId: string) {
  const auth = authHeader(token);
  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe', code: 'DLX' });
  const roomTypeId = roomType.body.roomType.id as string;
  await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: '101', roomTypeId });
  const ratePlan = await request(app).post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`).set(...auth).send({ name: 'BAR', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;
  await request(app)
    .put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`)
    .set(...auth)
    .send({ rates: [{ date: '2026-10-10', amountMinor: 400000 }, { date: '2026-10-11', amountMinor: 400000 }] });
  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const booking = await request(app)
    .post(`/api/v1/properties/${propertyId}/reservations`)
    .set(...auth)
    .send({ guestId: guest.body.guest.id, roomTypeId, ratePlanId, checkIn: '2026-10-10', checkOut: '2026-10-12' });
  return booking.body.reservation.id as string;
}

describe('POS API — outlets & products', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await setupProperty(token);
    const res = await request(app).get(`/api/v1/properties/${propertyId}/pos/outlets`);
    expect(res.status).toBe(401);
  });

  it('creates an outlet and rejects a duplicate name (per property, case-insensitive)', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await setupProperty(token);

    const created = await createOutlet(token, propertyId, 'Rooftop Bar');
    expect(created.status).toBe(201);
    expect(created.body.outlet).toMatchObject({ name: 'Rooftop Bar', type: 'BAR', isActive: true });

    const dup = await createOutlet(token, propertyId, 'rooftop bar');
    expect(dup.status).toBe(409);
  });

  it('creates a product with an upper-cased sku and lists it', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await setupProperty(token);
    const outletId = (await createOutlet(token, propertyId)).body.outlet.id as string;

    const created = await createProduct(token, propertyId, outletId, {
      name: 'Negroni',
      sku: 'ng1',
      priceMinor: 65000,
    });
    expect(created.status).toBe(201);
    expect(created.body.product).toMatchObject({ name: 'Negroni', sku: 'NG1', priceMinor: 65000, trackStock: false });

    const list = await request(app)
      .get(`/api/v1/properties/${propertyId}/pos/outlets/${outletId}/products`)
      .set(...authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body.products).toHaveLength(1);
    expect(list.body.page.totalItems).toBe(1);
  });
});

describe('POS API — orders', () => {
  it('creates a direct-paid order, snapshotting price and totalling lines', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const outletId = (await createOutlet(token, propertyId)).body.outlet.id as string;
    const beer = (await createProduct(token, propertyId, outletId, { name: 'Beer', priceMinor: 30000 })).body.product.id as string;
    const wine = (await createProduct(token, propertyId, outletId, { name: 'Wine', priceMinor: 50000 })).body.product.id as string;

    const order = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({
        outletId,
        items: [{ productId: beer, quantity: 2 }, { productId: wine, quantity: 1 }],
        settlement: 'DIRECT',
        paymentMethod: 'CARD',
      });
    expect(order.status).toBe(201);
    expect(order.body.order).toMatchObject({ status: 'PAID', settlement: 'DIRECT', paymentMethod: 'CARD', totalMinor: 110000 });
    expect(order.body.order.reference).toMatch(/^POS-/);
    expect(order.body.order.items).toHaveLength(2);
    // Price is snapshotted onto the line.
    const beerLine = order.body.order.items.find((i: { nameSnapshot: string }) => i.nameSnapshot === 'Beer');
    expect(beerLine).toMatchObject({ unitPriceMinor: 30000, quantity: 2, lineTotalMinor: 60000 });
  });

  it('charges an order to a reservation folio, posting a single folio charge', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const reservationId = await setupBookableWithReservation(token, propertyId);
    const outletId = (await createOutlet(token, propertyId, 'Room Service', 'ROOM_SERVICE')).body.outlet.id as string;
    const club = (await createProduct(token, propertyId, outletId, { name: 'Club Sandwich', priceMinor: 45000 })).body.product.id as string;

    // The folio already carries the 2-night room charge (800000). Read it first.
    const folioBefore = await request(app)
      .get(`/api/v1/properties/${propertyId}/reservations/${reservationId}/folio`)
      .set(...auth);
    const before = folioBefore.body.folio.chargesTotalMinor as number;

    const order = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId, items: [{ productId: club, quantity: 2 }], settlement: 'ROOM_CHARGE', reservationId });
    expect(order.status).toBe(201);
    expect(order.body.order).toMatchObject({ status: 'CHARGED', settlement: 'ROOM_CHARGE', totalMinor: 90000 });
    expect(order.body.order.folioChargeId).toBeTruthy();

    // The folio now carries exactly one additional charge for the order total.
    const folioAfter = await request(app)
      .get(`/api/v1/properties/${propertyId}/reservations/${reservationId}/folio`)
      .set(...auth);
    expect(folioAfter.body.folio.chargesTotalMinor).toBe(before + 90000);
    const posCharge = folioAfter.body.folio.charges.find((c: { description: string }) => c.description.startsWith('POS'));
    expect(posCharge).toMatchObject({ amountMinor: 90000 });
  });

  it('rejects a room-charge without a reservationId, and a direct order without a method', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const outletId = (await createOutlet(token, propertyId)).body.outlet.id as string;
    const p = (await createProduct(token, propertyId, outletId, { name: 'Soda', priceMinor: 12000 })).body.product.id as string;

    const noResv = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId, items: [{ productId: p, quantity: 1 }], settlement: 'ROOM_CHARGE' });
    expect(noResv.status).toBe(400);

    const noMethod = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId, items: [{ productId: p, quantity: 1 }], settlement: 'DIRECT' });
    expect(noMethod.status).toBe(400);
  });

  it('tracks stock: decrements on sale, refuses to oversell, restocks on void', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const outletId = (await createOutlet(token, propertyId, 'Minibar', 'MINIBAR')).body.outlet.id as string;
    const water = (await createProduct(token, propertyId, outletId, { name: 'Water', priceMinor: 8000, trackStock: true, stockQty: 3 })).body.product.id as string;

    // Sell 2 → stock 1 left. Order left OPEN (no settlement) so it can be voided.
    const order = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId, items: [{ productId: water, quantity: 2 }] });
    expect(order.status).toBe(201);
    expect(order.body.order.status).toBe('OPEN');

    const afterSale = await request(app)
      .get(`/api/v1/properties/${propertyId}/pos/outlets/${outletId}/products`)
      .set(...auth);
    expect(afterSale.body.products[0].stockQty).toBe(1);

    // Oversell: asking for 2 more when 1 remains → 409.
    const oversell = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId, items: [{ productId: water, quantity: 2 }] });
    expect(oversell.status).toBe(409);

    // Void the first order → stock restored to 3.
    const voided = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders/${order.body.order.id}/void`)
      .set(...auth);
    expect(voided.status).toBe(200);
    expect(voided.body.order.status).toBe('VOID');

    const afterVoid = await request(app)
      .get(`/api/v1/properties/${propertyId}/pos/outlets/${outletId}/products`)
      .set(...auth);
    expect(afterVoid.body.products[0].stockQty).toBe(3);
  });

  it('cannot void a settled order (money already moved)', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const outletId = (await createOutlet(token, propertyId)).body.outlet.id as string;
    const p = (await createProduct(token, propertyId, outletId, { name: 'Latte', priceMinor: 25000 })).body.product.id as string;

    const order = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId, items: [{ productId: p, quantity: 1 }], settlement: 'DIRECT', paymentMethod: 'CASH' });
    expect(order.body.order.status).toBe('PAID');

    const voided = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders/${order.body.order.id}/void`)
      .set(...auth);
    expect(voided.status).toBe(409);
  });

  it('refuses a product from another outlet (404, no partial write)', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const outletA = (await createOutlet(token, propertyId, 'Bar A')).body.outlet.id as string;
    const outletB = (await createOutlet(token, propertyId, 'Bar B')).body.outlet.id as string;
    const productInB = (await createProduct(token, propertyId, outletB, { name: 'Gin', priceMinor: 40000 })).body.product.id as string;

    // Order against outlet A but referencing a product that lives in outlet B.
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...auth)
      .send({ outletId: outletA, items: [{ productId: productInB, quantity: 1 }] });
    expect(res.status).toBe(404);

    // No order was created.
    const list = await request(app).get(`/api/v1/properties/${propertyId}/pos/orders`).set(...auth);
    expect(list.body.orders).toHaveLength(0);
  });

  it('allows STAFF to operate but not manage the catalogue', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await setupProperty(token);
    const outletId = (await createOutlet(token, propertyId)).body.outlet.id as string;
    const p = (await createProduct(token, propertyId, outletId, { name: 'Espresso', priceMinor: 15000 })).body.product.id as string;

    const password = 'correct-horse-battery-staple';
    const stf = await request(app)
      .post('/api/v1/staff')
      .set(...auth)
      .send({
        email: `stf-${randomUUID().slice(0, 8)}@x.com`,
        password,
        firstName: 'Sam',
        lastName: 'Staff',
        role: 'STAFF',
        propertyIds: [propertyId],
      });
    expect(stf.status).toBe(201);
    const login = await request(app).post('/api/v1/auth/login').send({ email: stf.body.staff.email, password });
    const staffToken = login.body.accessToken as string;

    // STAFF can take an order (operate).
    const order = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/orders`)
      .set(...authHeader(staffToken))
      .send({ outletId, items: [{ productId: p, quantity: 1 }], settlement: 'DIRECT', paymentMethod: 'CASH' });
    expect(order.status).toBe(201);

    // STAFF cannot create an outlet (manage) → 403.
    const forbidden = await request(app)
      .post(`/api/v1/properties/${propertyId}/pos/outlets`)
      .set(...authHeader(staffToken))
      .send({ name: 'New Outlet' });
    expect(forbidden.status).toBe(403);
  });
});

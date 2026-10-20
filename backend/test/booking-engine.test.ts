/**
 * Public booking engine (guest-facing). Exercises the one unauthenticated
 * surface end to end against a real database: a staff owner sets up a priced,
 * bookable property, then an ANONYMOUS client (no token) searches availability
 * by the property's public slug, books a room, and gets a confirmation —
 * proving the slug→org resolution, system-context reuse of the audited booking
 * path, server-side re-pricing, availability enforcement, and that no other
 * tenant's data leaks.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Build a priced, bookable property via the authenticated staff API and
 * return its public slug plus the ids a booking echoes back. */
async function setupBookableProperty(token: string, opts: { rooms?: number; price?: number } = {}) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);
  const slug = `hotel-${suffix}`;

  const property = await request(app)
    .post('/api/v1/properties')
    .set(...auth)
    .send({ name: `Hotel ${suffix}`, slug, city: 'Mumbai', country: 'India' });
  expect(property.status).toBe(201);
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

  return { slug, propertyId, roomTypeId, ratePlanId };
}

const WINDOW = { checkIn: '2026-10-10', checkOut: '2026-10-13' }; // 3 nights

describe('public booking engine — search', () => {
  it('returns the public property by slug with no auth', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const { slug } = await setupBookableProperty(token);

    const res = await request(app).get(`/api/v1/book/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.property.slug).toBe(slug);
    expect(res.body.property.city).toBe('Mumbai');
    // No internal ids leaked on the property projection.
    expect(res.body.property.id).toBeUndefined();
    expect(res.body.property.organizationId).toBeUndefined();
  });

  it('404s for an unknown slug', async () => {
    const res = await request(app).get('/api/v1/book/no-such-hotel-xyz');
    expect(res.status).toBe(404);
  });

  it('searches availability + pricing with no auth', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const { slug, roomTypeId, ratePlanId } = await setupBookableProperty(token, { price: 450000 });

    const res = await request(app).get(`/api/v1/book/${slug}/search`).query(WINDOW);
    expect(res.status).toBe(200);
    expect(res.body.options).toHaveLength(1);
    const opt = res.body.options[0];
    expect(opt.roomTypeId).toBe(roomTypeId);
    expect(opt.ratePlanId).toBe(ratePlanId);
    expect(opt.nights).toBe(3);
    expect(opt.totalMinor).toBe(450000 * 3);
    expect(opt.avgNightlyMinor).toBe(450000);
    expect(opt.roomsLeft).toBe(2);
  });

  it('omits room types with no price for the window', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const { slug } = await setupBookableProperty(token);
    // A window outside the priced month (Oct) → no bookable options.
    const res = await request(app)
      .get(`/api/v1/book/${slug}/search`)
      .query({ checkIn: '2026-12-10', checkOut: '2026-12-12' });
    expect(res.status).toBe(200);
    expect(res.body.options).toHaveLength(0);
  });

  it('rejects an inverted date window with 400', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const { slug } = await setupBookableProperty(token);
    const res = await request(app)
      .get(`/api/v1/book/${slug}/search`)
      .query({ checkIn: '2026-10-13', checkOut: '2026-10-10' });
    expect(res.status).toBe(400);
  });
});

describe('public booking engine — book', () => {
  function bookBody(ids: { roomTypeId: string; ratePlanId: string }, over: Record<string, unknown> = {}) {
    return {
      roomTypeId: ids.roomTypeId,
      ratePlanId: ids.ratePlanId,
      ...WINDOW,
      adults: 2,
      guest: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
      ...over,
    };
  }

  it('creates a booking with no auth and returns a confirmation', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const ids = await setupBookableProperty(token, { price: 450000 });

    const res = await request(app).post(`/api/v1/book/${ids.slug}/book`).send(bookBody(ids));
    expect(res.status).toBe(201);
    const c = res.body.confirmation;
    expect(c.reference).toMatch(/^LC-/);
    expect(c.nights).toBe(3);
    expect(c.totalMinor).toBe(450000 * 3);
    expect(c.guestName).toBe('Grace Hopper');
    expect(c.roomTypeName).toBe('Deluxe King');

    // The booking is visible to staff — it really landed in this tenant.
    const list = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...authHeader(token));
    expect(list.body.reservations.some((r: { reference: string }) => r.reference === c.reference)).toBe(true);
  });

  it('requires a contact method (email or phone)', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const ids = await setupBookableProperty(token);
    const res = await request(app)
      .post(`/api/v1/book/${ids.slug}/book`)
      .send(bookBody(ids, { guest: { firstName: 'No', lastName: 'Contact' } }));
    expect(res.status).toBe(400);
  });

  it('enforces availability — cannot oversell the last room', async () => {
    const { token } = await loginAsNewOwner('BE Hotel');
    const ids = await setupBookableProperty(token, { rooms: 1 });

    const first = await request(app).post(`/api/v1/book/${ids.slug}/book`).send(bookBody(ids));
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/v1/book/${ids.slug}/book`).send(bookBody(ids));
    expect(second.status).toBe(409); // no rooms left for the overlapping window
  });

  it('re-prices server-side and 404s a rate plan from another property', async () => {
    const a = await loginAsNewOwner('Org A');
    const idsA = await setupBookableProperty(a.token);
    const b = await loginAsNewOwner('Org B');
    const idsB = await setupBookableProperty(b.token);

    // Try to book property A using property B's rate plan id → not found.
    const res = await request(app)
      .post(`/api/v1/book/${idsA.slug}/book`)
      .send(bookBody({ roomTypeId: idsA.roomTypeId, ratePlanId: idsB.ratePlanId }));
    expect(res.status).toBe(404);
  });
});

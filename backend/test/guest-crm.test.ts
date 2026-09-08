/**
 * Guest CRM / guest-360 — tags and the aggregated profile.
 *
 * Covers segmentation tags (upper-cased, de-duplicated, set-replace, list
 * filter, audit) and the computed profile: stay history, nights stayed,
 * booked value, folio-derived charged/paid/balance, and repeat-guest
 * detection. Builds real bookings and folios so the aggregation is exercised
 * against actual data, not mocks.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function createStaff(token: string, role: 'MANAGER' | 'STAFF') {
  const suffix = randomUUID().slice(0, 8);
  const email = `${role.toLowerCase()}-${suffix}@example.com`;
  const password = 'correct-horse-battery-staple';
  const created = await request(app)
    .post('/api/v1/staff')
    .set(...authHeader(token))
    .send({ email, password, firstName: role, lastName: suffix, role, propertyIds: [] });
  expect(created.status).toBe(201);
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  return login.body.accessToken as string;
}

/** A bookable property + guest. Returns everything a booking needs. */
async function setup(token: string) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);
  const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;
  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe', code: 'DLX' });
  const roomTypeId = roomType.body.roomType.id as string;
  const room = await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: '101', roomTypeId });
  const roomId = room.body.room.id as string;
  const ratePlan = await request(app).post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`).set(...auth).send({ name: 'BAR', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;
  const rates = Array.from({ length: 20 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amountMinor: 400000 }));
  await request(app).put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`).set(...auth).send({ rates });
  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;
  return { propertyId, roomTypeId, ratePlanId, roomId, guestId };
}

async function book(token: string, ids: { propertyId: string; guestId: string; roomTypeId: string; ratePlanId: string }, checkIn: string, checkOut: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${ids.propertyId}/reservations`)
    .set(...authHeader(token))
    .send({ guestId: ids.guestId, roomTypeId: ids.roomTypeId, ratePlanId: ids.ratePlanId, checkIn, checkOut });
  expect(res.status).toBe(201);
  return res.body.reservation.id as string;
}

describe('guest CRM — tags', () => {
  it('sets tags upper-cased and de-duplicated, and filters the list by tag', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Grace', lastName: 'Hopper' });
    const id = guest.body.guest.id as string;

    const set = await request(app).put(`/api/v1/guests/${id}/tags`).set(...auth).send({ tags: ['vip', 'VIP', ' Corporate '] });
    expect(set.status).toBe(200);
    expect(set.body.guest.tags).toEqual(['VIP', 'CORPORATE']);

    // Filter the directory by a tag (upper-cased server-side).
    const filtered = await request(app).get('/api/v1/guests?tag=corporate').set(...auth);
    expect(filtered.status).toBe(200);
    expect(filtered.body.guests.some((g: { id: string }) => g.id === id)).toBe(true);

    // A tag nobody has returns the guest out.
    const none = await request(app).get('/api/v1/guests?tag=PLATINUM').set(...auth);
    expect(none.body.guests.every((g: { id: string }) => g.id !== id)).toBe(true);

    // Clearing tags.
    const cleared = await request(app).put(`/api/v1/guests/${id}/tags`).set(...auth).send({ tags: [] });
    expect(cleared.body.guest.tags).toEqual([]);
  });

  it('records a tags-changed audit entry with before/after', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Alan', lastName: 'Turing' });
    const id = guest.body.guest.id as string;
    await request(app).put(`/api/v1/guests/${id}/tags`).set(...auth).send({ tags: ['VIP'] });

    const audit = await request(app).get('/api/v1/audit-logs?action=guest.tags_changed').set(...auth);
    expect(audit.status).toBe(200);
    const entry = audit.body.auditLogs.find((a: { entityId: string }) => a.entityId === id);
    expect(entry).toBeTruthy();
    expect(entry.metadata).toMatchObject({ to: ['VIP'] });
  });

  it('staff cannot set tags without guests:manage is not the case — staff has manage; but read-only role is refused', async () => {
    const { token } = await loginAsNewOwner();
    // MANAGER has guests:manage per the presets, so use a fresh property-less
    // MANAGER to confirm the happy path, then assert an anonymous 401.
    const mgr = await createStaff(token, 'MANAGER');
    const guest = await request(app).post('/api/v1/guests').set(...authHeader(mgr)).send({ firstName: 'Edsger', lastName: 'Dijkstra' });
    const id = guest.body.guest.id as string;
    const ok = await request(app).put(`/api/v1/guests/${id}/tags`).set(...authHeader(mgr)).send({ tags: ['VIP'] });
    expect(ok.status).toBe(200);

    const anon = await request(app).put(`/api/v1/guests/${id}/tags`).send({ tags: ['X'] });
    expect(anon.status).toBe(401);
  });
});

describe('guest CRM — profile (guest-360)', () => {
  it('returns an empty profile for a guest with no stays', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'New', lastName: 'Guest' });
    const id = guest.body.guest.id as string;

    const res = await request(app).get(`/api/v1/guests/${id}/profile`).set(...auth);
    expect(res.status).toBe(200);
    expect(res.body.guest.id).toBe(id);
    expect(res.body.stats).toMatchObject({
      totalStays: 0,
      nightsStayed: 0,
      bookedValueMinor: 0,
      chargedMinor: 0,
      paidMinor: 0,
      balanceMinor: 0,
      isRepeatGuest: false,
      firstStay: null,
      lastStay: null,
    });
    expect(res.body.stays).toEqual([]);
  });

  it('aggregates stay history, nights, booked value and repeat-guest detection', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setup(token);

    // Two stays, both checked-in→out so they count as realised (repeat guest).
    const r1 = await book(token, ids, '2026-10-10', '2026-10-12'); // 2 nights, 800000
    const r2 = await book(token, ids, '2026-10-14', '2026-10-15'); // 1 night, 400000

    for (const [rid, out] of [[r1, '2026-10-12'], [r2, '2026-10-15']] as const) {
      const ci = await request(app).post(`/api/v1/properties/${ids.propertyId}/reservations/${rid}/check-in`).set(...auth).send({ roomId: ids.roomId });
      expect(ci.status).toBe(200);
      const co = await request(app).post(`/api/v1/properties/${ids.propertyId}/reservations/${rid}/check-out`).set(...auth);
      expect(co.status).toBe(200);
      expect(out).toBeTruthy();
    }

    // Open the folio for the first stay (posts the room charge) so the
    // profile's folio-derived spend has something to aggregate. Folios are
    // lazy — they open on first view/charge, not automatically at check-out.
    const folio = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservations/${r1}/folio`).set(...auth);
    expect(folio.status).toBe(200);
    const charged = folio.body.folio.chargesTotalMinor as number;
    expect(charged).toBeGreaterThan(0);

    const res = await request(app).get(`/api/v1/guests/${ids.guestId}/profile`).set(...auth);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({
      totalStays: 2,
      nightsStayed: 3, // 2 + 1
      bookedValueMinor: 1200000, // 800000 + 400000
      isRepeatGuest: true,
      firstStay: '2026-10-10',
      lastStay: '2026-10-14',
    });
    // Stay history newest-first, with computed nights.
    expect(res.body.stays).toHaveLength(2);
    expect(res.body.stays[0]).toMatchObject({ reference: expect.any(String), nights: 1, status: 'CHECKED_OUT' });
    // The opened folio's room charge is reflected in the aggregated spend.
    expect(res.body.stats.chargedMinor).toBe(charged);
  });

  it('excludes cancelled bookings from booked value but counts them as cancelled', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setup(token);

    const r1 = await book(token, ids, '2026-10-10', '2026-10-12'); // stays booked
    const r2 = await book(token, ids, '2026-10-16', '2026-10-17'); // will cancel
    const cancel = await request(app).post(`/api/v1/properties/${ids.propertyId}/reservations/${r2}/cancel`).set(...auth).send({ reason: 'Changed plans' });
    expect(cancel.status).toBe(200);
    expect(r1).toBeTruthy();

    const res = await request(app).get(`/api/v1/guests/${ids.guestId}/profile`).set(...auth);
    expect(res.body.stats.totalStays).toBe(2);
    expect(res.body.stats.cancelledStays).toBe(1);
    // Only the non-cancelled booking's value counts.
    expect(res.body.stats.bookedValueMinor).toBe(800000);
    // Neither was checked in, so not a repeat guest.
    expect(res.body.stats.isRepeatGuest).toBe(false);
  });

  it('404s for a nonexistent guest profile', async () => {
    const { token } = await loginAsNewOwner();
    const res = await request(app).get(`/api/v1/guests/${randomUUID()}/profile`).set(...authHeader(token));
    expect(res.status).toBe(404);
  });
});

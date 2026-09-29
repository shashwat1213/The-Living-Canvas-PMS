/**
 * Reservation groups / block bookings.
 *
 * Proves a block books several rooms atomically under one header, checks
 * availability against its own running tally (so it can't oversell against
 * itself), and rolls the whole block back if any room can't be placed. Also
 * covers listing, detail, tenant isolation, and cancelling a whole block.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** A property with N ACTIVE rooms of one type, a BAR plan priced across Oct 2026. */
async function setupBookableProperty(token: string, opts: { rooms?: number; price?: number } = {}) {
  const auth = authHeader(token);
  const suffix = randomUUID().slice(0, 8);

  const property = await request(app).post('/api/v1/properties').set(...auth).send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}` });
  const propertyId = property.body.property.id as string;

  const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...auth).send({ name: 'Deluxe King', code: 'DLX' });
  const roomTypeId = roomType.body.roomType.id as string;

  const roomCount = opts.rooms ?? 5;
  for (let i = 1; i <= roomCount; i += 1) {
    const created = await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...auth).send({ name: `${100 + i}`, roomTypeId });
    expect(created.status).toBe(201);
  }

  const ratePlan = await request(app).post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`).set(...auth).send({ name: 'Best Available Rate', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;

  const price = opts.price ?? 450000;
  const rates = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, amountMinor: price }));
  const setRates = await request(app).put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`).set(...auth).send({ rates });
  expect(setRates.status).toBe(200);

  const guest = await request(app).post('/api/v1/guests').set(...auth).send({ firstName: 'Ada', lastName: 'Lovelace' });
  const guestId = guest.body.guest.id as string;

  return { propertyId, roomTypeId, ratePlanId, guestId };
}

function roomLine(ids: { roomTypeId: string; ratePlanId: string; guestId: string }, over: Record<string, unknown> = {}) {
  return {
    roomTypeId: ids.roomTypeId,
    ratePlanId: ids.ratePlanId,
    guestId: ids.guestId,
    checkIn: '2026-10-10',
    checkOut: '2026-10-13',
    ...over,
  };
}

describe('reservation groups (block bookings)', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const ids = await setupBookableProperty(token);
    const res = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .send({ name: 'Block', rooms: [roomLine(ids)] });
    expect(res.status).toBe(401);
  });

  it('books a multi-room block atomically under one header', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 5 });

    const res = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...auth)
      .send({
        name: 'Sharma Wedding',
        rooms: [roomLine(ids), roomLine(ids), roomLine(ids)],
      });
    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe('Sharma Wedding');
    expect(res.body.group.reference).toMatch(/^BLK-/);
    expect(res.body.group.reservations).toHaveLength(3);
    // Each child is an ordinary booking with its own reference and the block total.
    for (const r of res.body.group.reservations) {
      expect(r.reference).toMatch(/^LC-/);
      expect(r.status).toBe('CONFIRMED');
    }
    expect(res.body.group.totalAmountMinor).toBe(3 * 3 * 450000);

    // The block's rooms show up as ordinary reservations on the list.
    const list = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservations`).set(...auth);
    expect(list.body.reservations.length).toBe(3);
  });

  it('rolls the whole block back when it would oversell its own type', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    // Only 2 rooms of the type, but the block asks for 3 overlapping.
    const ids = await setupBookableProperty(token, { rooms: 2 });

    const res = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...auth)
      .send({ name: 'Too Big', rooms: [roomLine(ids), roomLine(ids), roomLine(ids)] });
    expect(res.status).toBe(409);

    // Nothing was created — no block, no bookings.
    const groups = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservation-groups`).set(...auth);
    expect(groups.body.groups).toHaveLength(0);
    const list = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservations`).set(...auth);
    expect(list.body.reservations).toHaveLength(0);
  });

  it('lists blocks and returns a block detail with its rooms', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 3 });

    const created = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...auth)
      .send({ name: 'Acme Corp', notes: 'Q4 offsite', rooms: [roomLine(ids), roomLine(ids)] });
    const groupId = created.body.group.id as string;

    const list = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservation-groups`).set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.groups).toHaveLength(1);
    expect(list.body.groups[0]).toMatchObject({ name: 'Acme Corp', roomCount: 2 });

    const detail = await request(app).get(`/api/v1/properties/${ids.propertyId}/reservation-groups/${groupId}`).set(...auth);
    expect(detail.status).toBe(200);
    expect(detail.body.group.reservations).toHaveLength(2);
    expect(detail.body.group.notes).toBe('Q4 offsite');
  });

  it('cancels a whole block, freeing every room', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });

    const created = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...auth)
      .send({ name: 'Weekend Block', rooms: [roomLine(ids), roomLine(ids)] });
    const groupId = created.body.group.id as string;

    const cancel = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups/${groupId}/cancel`)
      .set(...auth)
      .send({ reason: 'Event postponed' });
    expect(cancel.status).toBe(200);
    for (const r of cancel.body.group.reservations) {
      expect(r.status).toBe('CANCELLED');
    }

    // The rooms are free again: the same dates can be freshly booked.
    const rebook = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservations`)
      .set(...auth)
      .send({ ...roomLine(ids) });
    expect(rebook.status).toBe(201);
  });

  it('404s a block belonging to another organization and never leaks it', async () => {
    const { token: ownerA } = await loginAsNewOwner();
    const authA = authHeader(ownerA);
    const ids = await setupBookableProperty(ownerA, { rooms: 2 });
    const created = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...authA)
      .send({ name: 'Private', rooms: [roomLine(ids)] });
    const groupId = created.body.group.id as string;

    const { token: ownerB } = await loginAsNewOwner();
    const leak = await request(app)
      .get(`/api/v1/properties/${ids.propertyId}/reservation-groups/${groupId}`)
      .set(...authHeader(ownerB));
    expect(leak.status).toBe(404);
  });

  it('rejects a block with no rooms or an unknown contact guest', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const ids = await setupBookableProperty(token, { rooms: 2 });

    const empty = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...auth)
      .send({ name: 'Empty', rooms: [] });
    expect(empty.status).toBe(400);

    const badContact = await request(app)
      .post(`/api/v1/properties/${ids.propertyId}/reservation-groups`)
      .set(...auth)
      .send({ name: 'Bad', contactGuestId: randomUUID(), rooms: [roomLine(ids)] });
    expect(badContact.status).toBe(404);
  });
});

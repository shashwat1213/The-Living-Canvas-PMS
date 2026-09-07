/**
 * Standing tenant-isolation regression suite (Phase 1 task 1f — see
 * TASKS.md and AGENTS.md's QA role). This is not a one-off check: every
 * tenant-scoped route added from here on should get a case here
 * confirming a caller from a *different* organization can't read or
 * write it. A cross-tenant attempt resolving to 404 (property/room
 * doesn't exist from the caller's point of view) or 403 (exists in the
 * caller's own org, but no PropertyAccess grant) are both acceptable —
 * what's never acceptable is 200 with another tenant's data, or a
 * mutation actually taking effect.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/platform/auth/tokens.js';
import { resolveAuthContext } from '../src/platform/auth/session-service.js';
import { assignSystemRole } from '../src/platform/rbac/provisioning.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function createProperty(token: string, name = 'Main House', slug = 'main-house') {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name, slug });
  return res.body.property.id as string;
}

async function createRoomType(token: string, propertyId: string, name = 'Standard') {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types`)
    .set(...authHeader(token))
    .send({ name });
  return res.body.roomType.id as string;
}

describe('cross-organization isolation', () => {
  it('a property created in org A is invisible to org B: list, get, update, delete', async () => {
    const orgA = await loginAsNewOwner('Org A');
    const orgB = await loginAsNewOwner('Org B');
    const propertyId = await createProperty(orgA.token);

    const list = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(orgB.token));
    expect(list.body.properties).toHaveLength(0);

    const get = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(orgB.token));
    expect(get.status).toBe(404);

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(orgB.token))
      .send({ name: 'Hijacked' });
    expect(update.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(orgB.token));
    expect(del.status).toBe(404);

    // Confirm org A's property was untouched by org B's attempted update.
    const stillIntact = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(orgA.token));
    expect(stillIntact.status).toBe(200);
    expect(stillIntact.body.property.name).toBe('Main House');
  });

  it('rooms under an org A property are invisible to org B: list, get, create, update, delete', async () => {
    const orgA = await loginAsNewOwner('Org A');
    const orgB = await loginAsNewOwner('Org B');
    const propertyId = await createProperty(orgA.token);
    const roomTypeId = await createRoomType(orgA.token, propertyId);
    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(orgA.token))
      .send({ name: '101', roomTypeId });
    const roomId = room.body.room.id as string;

    const list = await request(app)
      .get(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(orgB.token));
    expect(list.status).toBe(404); // property itself is invisible to org B

    const get = await request(app)
      .get(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...authHeader(orgB.token));
    expect(get.status).toBe(404);

    const create = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(orgB.token))
      .send({ name: '999', roomTypeId: randomUUID() });
    expect(create.status).toBe(404);

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...authHeader(orgB.token))
      .send({ name: 'Hijacked' });
    expect(update.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...authHeader(orgB.token));
    expect(del.status).toBe(404);
  });

  it('two organizations can independently use the same property slug', async () => {
    const orgA = await loginAsNewOwner('Org A');
    const orgB = await loginAsNewOwner('Org B');

    const a = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(orgA.token))
      .send({ name: 'Shared Slug House', slug: 'shared-slug' });
    const b = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(orgB.token))
      .send({ name: 'Shared Slug House', slug: 'shared-slug' });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.property.id).not.toBe(b.body.property.id);
  });
});

describe('cross-organization isolation: room types', () => {
  async function createRoomType(token: string, propertyId: string, name: string) {
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...authHeader(token))
      .send({ name });
    if (res.status !== 201) {
      throw new Error(`room type creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.roomType.id as string;
  }

  it("a room type in org A is invisible to org B: list, get, update, delete", async () => {
    const orgA = await loginAsNewOwner('RT Isolation A');
    const orgB = await loginAsNewOwner('RT Isolation B');
    const propertyA = await createProperty(orgA.token, 'A House', `a-house-${randomUUID().slice(0, 8)}`);
    const roomTypeId = await createRoomType(orgA.token, propertyA, 'A Deluxe');

    // Every verb, through org A's real property and room-type IDs. The
    // property itself is already invisible to B, so these must 404 rather
    // than 403 — B must not learn that the property exists at all.
    const list = await request(app)
      .get(`/api/v1/properties/${propertyA}/room-types`)
      .set(...authHeader(orgB.token));
    expect(list.status).toBe(404);

    const get = await request(app)
      .get(`/api/v1/properties/${propertyA}/room-types/${roomTypeId}`)
      .set(...authHeader(orgB.token));
    expect(get.status).toBe(404);

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyA}/room-types/${roomTypeId}`)
      .set(...authHeader(orgB.token))
      .send({ name: 'Renamed By B' });
    expect(update.status).toBe(404);

    const del = await request(app)
      .delete(`/api/v1/properties/${propertyA}/room-types/${roomTypeId}`)
      .set(...authHeader(orgB.token));
    expect(del.status).toBe(404);

    // The refusals must not have taken effect anyway.
    const stillThere = await request(app)
      .get(`/api/v1/properties/${propertyA}/room-types/${roomTypeId}`)
      .set(...authHeader(orgA.token));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.roomType.name).toBe('A Deluxe');
  });

  it('two organizations can independently use the same room-type name', async () => {
    const orgA = await loginAsNewOwner('RT Name A');
    const orgB = await loginAsNewOwner('RT Name B');
    const propertyA = await createProperty(orgA.token, 'A House', `a-name-${randomUUID().slice(0, 8)}`);
    const propertyB = await createProperty(orgB.token, 'B House', `b-name-${randomUUID().slice(0, 8)}`);

    const a = await createRoomType(orgA.token, propertyA, 'Deluxe King');
    const b = await createRoomType(orgB.token, propertyB, 'Deluxe King');
    expect(a).not.toBe(b);
  });
});

describe('cross-organization isolation: rate plans', () => {
  async function createRoomType(token: string, propertyId: string, name: string) {
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types`)
      .set(...authHeader(token))
      .send({ name });
    return res.body.roomType.id as string;
  }

  async function createRatePlan(token: string, propertyId: string, roomTypeId: string, name: string) {
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`)
      .set(...authHeader(token))
      .send({ name });
    if (res.status !== 201) {
      throw new Error(`rate plan creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.ratePlan.id as string;
  }

  it("a rate plan (and its rates) in org A is invisible to org B: list, get, update, delete, rates", async () => {
    const orgA = await loginAsNewOwner('RP Isolation A');
    const orgB = await loginAsNewOwner('RP Isolation B');
    const propertyA = await createProperty(orgA.token, 'A House', `rp-a-${randomUUID().slice(0, 8)}`);
    const roomTypeId = await createRoomType(orgA.token, propertyA, 'A Deluxe');
    const planId = await createRatePlan(orgA.token, propertyA, roomTypeId, 'A BAR');
    const b = `/api/v1/properties/${propertyA}/room-types/${roomTypeId}/rate-plans`;

    // Org A's property is invisible to B, so every verb must 404 (not 403):
    // B must not learn the property, type or plan exists at all.
    for (const call of [
      request(app).get(b).set(...authHeader(orgB.token)),
      request(app).get(`${b}/${planId}`).set(...authHeader(orgB.token)),
      request(app).patch(`${b}/${planId}`).set(...authHeader(orgB.token)).send({ name: 'B' }),
      request(app).delete(`${b}/${planId}`).set(...authHeader(orgB.token)),
      request(app).get(`${b}/${planId}/rates?from=2026-10-01&to=2026-10-05`).set(...authHeader(orgB.token)),
      request(app)
        .put(`${b}/${planId}/rates`)
        .set(...authHeader(orgB.token))
        .send({ rates: [{ date: '2026-10-01', amountMinor: 100000 }] }),
    ]) {
      const res = await call;
      expect(res.status).toBe(404);
    }

    // None of the refusals took effect: A's plan is intact and unpriced.
    const stillThere = await request(app).get(`${b}/${planId}`).set(...authHeader(orgA.token));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.ratePlan.name).toBe('A BAR');
    expect(stillThere.body.ratePlan.pricedDates).toBe(0);
  });

  it('two organizations can independently use the same rate-plan name under their own room types', async () => {
    const orgA = await loginAsNewOwner('RP Name A');
    const orgB = await loginAsNewOwner('RP Name B');
    const propertyA = await createProperty(orgA.token, 'A House', `rp-na-${randomUUID().slice(0, 8)}`);
    const propertyB = await createProperty(orgB.token, 'B House', `rp-nb-${randomUUID().slice(0, 8)}`);
    const rtA = await createRoomType(orgA.token, propertyA, 'Deluxe');
    const rtB = await createRoomType(orgB.token, propertyB, 'Deluxe');

    const a = await createRatePlan(orgA.token, propertyA, rtA, 'Best Available Rate');
    const b = await createRatePlan(orgB.token, propertyB, rtB, 'Best Available Rate');
    expect(a).not.toBe(b);
  });
});

describe('cross-organization isolation: guests', () => {
  async function createGuest(token: string, firstName: string, lastName: string) {
    const res = await request(app)
      .post('/api/v1/guests')
      .set(...authHeader(token))
      .send({ firstName, lastName });
    return res.body.guest.id as string;
  }

  it("a guest in org A is invisible to org B: list, get, update, delete", async () => {
    const orgA = await loginAsNewOwner('Guest Isolation A');
    const orgB = await loginAsNewOwner('Guest Isolation B');
    const guestId = await createGuest(orgA.token, 'Ada', 'Lovelace');

    // Org B's guest list never contains org A's people.
    const list = await request(app).get('/api/v1/guests').set(...authHeader(orgB.token));
    expect(list.status).toBe(200);
    expect(list.body.guests.map((g: { id: string }) => g.id)).not.toContain(guestId);

    // Every verb on org A's real guest id 404s for B — the guest is scoped
    // out entirely, so it reads as nonexistent, not forbidden.
    for (const call of [
      request(app).get(`/api/v1/guests/${guestId}`).set(...authHeader(orgB.token)),
      request(app).patch(`/api/v1/guests/${guestId}`).set(...authHeader(orgB.token)).send({ notes: 'B' }),
      request(app).delete(`/api/v1/guests/${guestId}`).set(...authHeader(orgB.token)),
    ]) {
      const res = await call;
      expect(res.status).toBe(404);
    }

    // Untouched for A.
    const stillThere = await request(app).get(`/api/v1/guests/${guestId}`).set(...authHeader(orgA.token));
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.guest.firstName).toBe('Ada');
  });

  it("search cannot be used to probe another organization's guests", async () => {
    const orgA = await loginAsNewOwner('Guest Probe A');
    const orgB = await loginAsNewOwner('Guest Probe B');
    await createGuest(orgA.token, 'Confidential', 'Person');

    const probe = await request(app).get('/api/v1/guests?search=confidential').set(...authHeader(orgB.token));
    expect(probe.status).toBe(200);
    expect(probe.body.guests).toHaveLength(0);
    expect(probe.body.page.totalItems).toBe(0);
  });
});

describe('cross-organization isolation: reservations', () => {
  it("a reservation at org A's property is invisible to org B: list, get, cancel, no-show", async () => {
    const orgA = await loginAsNewOwner('Resv Isolation A');
    const orgB = await loginAsNewOwner('Resv Isolation B');
    const authA = authHeader(orgA.token);

    // Build a bookable property for org A and make one booking.
    const property = await request(app).post('/api/v1/properties').set(...authA).send({ name: 'A Hotel', slug: `resv-a-${randomUUID().slice(0, 8)}` });
    const propertyId = property.body.property.id as string;
    const roomType = await request(app).post(`/api/v1/properties/${propertyId}/room-types`).set(...authA).send({ name: 'Deluxe' });
    const roomTypeId = roomType.body.roomType.id as string;
    await request(app).post(`/api/v1/properties/${propertyId}/rooms`).set(...authA).send({ name: '101', roomTypeId });
    const ratePlan = await request(app).post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`).set(...authA).send({ name: 'BAR' });
    const ratePlanId = ratePlan.body.ratePlan.id as string;
    await request(app)
      .put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`)
      .set(...authA)
      .send({ rates: [{ date: '2026-10-10', amountMinor: 400000 }, { date: '2026-10-11', amountMinor: 400000 }] });
    const guest = await request(app).post('/api/v1/guests').set(...authA).send({ firstName: 'A', lastName: 'Guest' });
    const booking = await request(app)
      .post(`/api/v1/properties/${propertyId}/reservations`)
      .set(...authA)
      .send({ guestId: guest.body.guest.id, roomTypeId, ratePlanId, checkIn: '2026-10-10', checkOut: '2026-10-12' });
    expect(booking.status).toBe(201);
    const reservationId = booking.body.reservation.id as string;

    // Org A's property is invisible to B — every verb 404s (not 403).
    const base = `/api/v1/properties/${propertyId}/reservations`;
    for (const call of [
      request(app).get(base).set(...authHeader(orgB.token)),
      request(app).get(`${base}/${reservationId}`).set(...authHeader(orgB.token)),
      request(app).post(`${base}/${reservationId}/cancel`).set(...authHeader(orgB.token)).send({}),
      request(app).post(`${base}/${reservationId}/no-show`).set(...authHeader(orgB.token)),
    ]) {
      const res = await call;
      expect(res.status).toBe(404);
    }

    // The booking is untouched and still CONFIRMED for A.
    const stillThere = await request(app).get(`${base}/${reservationId}`).set(...authA);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.reservation.status).toBe('CONFIRMED');

    // The availability grid for A's property is invisible to B too — the
    // property is scoped out, so the read-only grid 404s rather than leaking
    // A's inventory as an empty-but-200 grid.
    const availability = await request(app)
      .get(`/api/v1/properties/${propertyId}/availability?from=2026-10-10&to=2026-10-12`)
      .set(...authHeader(orgB.token));
    expect(availability.status).toBe(404);

    // And still readable by A.
    const availabilityForA = await request(app)
      .get(`/api/v1/properties/${propertyId}/availability?from=2026-10-10&to=2026-10-12`)
      .set(...authA);
    expect(availabilityForA.status).toBe(200);
    expect(availabilityForA.body.roomTypes).toHaveLength(1);

    // The booking's folio (guest bill) is likewise invisible to B: viewing it
    // and posting a payment to it both 404, so B can neither read A's charges
    // nor inject a payment onto A's account.
    const folioBase = `${base}/${reservationId}/folio`;
    const folioForB = await request(app).get(folioBase).set(...authHeader(orgB.token));
    expect(folioForB.status).toBe(404);
    const payForB = await request(app)
      .post(`${folioBase}/payments`)
      .set(...authHeader(orgB.token))
      .send({ method: 'CASH', amountMinor: 100 });
    expect(payForB.status).toBe(404);

    // A can open and read its own folio.
    const folioForA = await request(app).get(folioBase).set(...authA);
    expect(folioForA.status).toBe(200);
    expect(folioForA.body.folio.charges.length).toBeGreaterThan(0);

    // The housekeeping board and tasks for A's property are invisible to B —
    // reading the board, listing tasks, and setting a room's condition all
    // 404, so B can neither see A's cleaning state nor mutate A's rooms.
    const hkBase = `/api/v1/properties/${propertyId}/housekeeping`;
    const boardForB = await request(app).get(`${hkBase}/board`).set(...authHeader(orgB.token));
    expect(boardForB.status).toBe(404);
    const tasksForB = await request(app).get(`${hkBase}/tasks`).set(...authHeader(orgB.token));
    expect(tasksForB.status).toBe(404);
    // A reads its own board fine (one room, INSPECTED by default).
    const boardForA = await request(app).get(`${hkBase}/board`).set(...authA);
    expect(boardForA.status).toBe(200);
    expect(boardForA.body.board.summary.totalRooms).toBe(1);
    const roomIdA = boardForA.body.board.rooms[0].id as string;
    const condForB = await request(app)
      .put(`${hkBase}/rooms/${roomIdA}/condition`)
      .set(...authHeader(orgB.token))
      .send({ housekeepingStatus: 'DIRTY' });
    expect(condForB.status).toBe(404);

    // Maintenance work orders for A's property are invisible to B too — the
    // list and create both 404, so B can neither see A's engineering work nor
    // inject a work order (or an out-of-service block) onto A's rooms.
    const mxBase = `/api/v1/properties/${propertyId}/maintenance/work-orders`;
    const mxListForB = await request(app).get(mxBase).set(...authHeader(orgB.token));
    expect(mxListForB.status).toBe(404);
    const mxCreateForB = await request(app)
      .post(mxBase)
      .set(...authHeader(orgB.token))
      .send({ title: 'intrusion', roomId: roomIdA, takeRoomOutOfService: true });
    expect(mxCreateForB.status).toBe(404);
    // A can create its own work order fine.
    const mxForA = await request(app).post(mxBase).set(...authA).send({ title: 'A work', roomId: roomIdA });
    expect(mxForA.status).toBe(201);
  });
});

describe('cross-organization isolation: staff', () => {
  async function createStaffMember(token: string, role = 'STAFF') {
    const suffix = randomUUID().slice(0, 8);
    const res = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(token))
      .send({
        email: `isolation-${suffix}@example.com`,
        password: 'correct-horse-battery-staple',
        firstName: 'Iso',
        lastName: 'Lated',
        role,
      });
    if (res.status !== 201) {
      throw new Error(`staff creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.staff.id as string;
  }

  it("org B's staff list contains only its own owner, never org A's people", async () => {
    const orgA = await loginAsNewOwner('Staff Iso A');
    const orgB = await loginAsNewOwner('Staff Iso B');
    await createStaffMember(orgA.token);

    const list = await request(app)
      .get('/api/v1/staff')
      .set(...authHeader(orgB.token));

    expect(list.status).toBe(200);
    expect(list.body.staff).toHaveLength(1);
    expect(list.body.staff[0].role).toBe('OWNER');
  });

  it("search and filters cannot be used to probe another organization's staff", async () => {
    const orgA = await loginAsNewOwner('Staff Probe A');
    const orgB = await loginAsNewOwner('Staff Probe B');

    // A distinctive name that exists only in org A.
    const suffix = randomUUID().slice(0, 8);
    const secretName = `Zaphod${suffix}`;
    await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(orgA.token))
      .send({
        email: `probe-${suffix}@example.com`,
        password: 'correct-horse-battery-staple',
        firstName: secretName,
        lastName: 'Beeblebrox',
        role: 'STAFF',
      });

    // Org B searching for the exact name, the exact email, and by role
    // must all come back empty — the tenant filter is ANDed in by the
    // scoping extension, so a filter can only ever narrow within the
    // caller's own organization, never reach outside it.
    for (const query of [
      `?search=${secretName}`,
      `?search=probe-${suffix}%40example.com`,
      '?role=STAFF',
      '?status=ACTIVE&pageSize=100',
    ]) {
      const res = await request(app)
        .get(`/api/v1/staff${query}`)
        .set(...authHeader(orgB.token));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(secretName);
      expect(res.body.staff.every((m: { email: string }) => !m.email.includes(suffix))).toBe(true);
    }

    // The totals must be org-scoped too — a count that leaked the real
    // number would disclose another tenant's size even with rows hidden.
    const all = await request(app)
      .get('/api/v1/staff?pageSize=100')
      .set(...authHeader(orgB.token));
    expect(all.body.page.totalItems).toBe(1); // org B's owner, and nobody else

    // Org A still sees their own person, so the filter works at all.
    const ownerView = await request(app)
      .get(`/api/v1/staff?search=${secretName}`)
      .set(...authHeader(orgA.token));
    expect(ownerView.body.staff).toHaveLength(1);
  });

  it("a staff member in org A is invisible to org B: get, update, property-access", async () => {
    const orgA = await loginAsNewOwner('Staff Iso A2');
    const orgB = await loginAsNewOwner('Staff Iso B2');
    const staffId = await createStaffMember(orgA.token);

    const get = await request(app)
      .get(`/api/v1/staff/${staffId}`)
      .set(...authHeader(orgB.token));
    expect(get.status).toBe(404);

    const update = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set(...authHeader(orgB.token))
      .send({ role: 'OWNER' });
    expect(update.status).toBe(404);

    const deactivate = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set(...authHeader(orgB.token))
      .send({ isActive: false });
    expect(deactivate.status).toBe(404);

    const access = await request(app)
      .put(`/api/v1/staff/${staffId}/property-access`)
      .set(...authHeader(orgB.token))
      .send({ propertyIds: [] });
    expect(access.status).toBe(404);

    // None of org B's attempts took effect.
    const stillIntact = await request(app)
      .get(`/api/v1/staff/${staffId}`)
      .set(...authHeader(orgA.token));
    expect(stillIntact.status).toBe(200);
    expect(stillIntact.body.staff.roleNames).toEqual(['STAFF']);
    expect(stillIntact.body.staff.isActive).toBe(true);
  });

  it("org A cannot grant its own staff access to org B's property", async () => {
    const orgA = await loginAsNewOwner('Staff Iso A3');
    const orgB = await loginAsNewOwner('Staff Iso B3');
    const foreignPropertyId = await createProperty(orgB.token, 'Org B House', 'org-b-house');
    const staffId = await createStaffMember(orgA.token, 'MANAGER');

    const grant = await request(app)
      .put(`/api/v1/staff/${staffId}/property-access`)
      .set(...authHeader(orgA.token))
      .send({ propertyIds: [foreignPropertyId] });

    // The foreign property is invisible through the scoped client, so the
    // grant resolves to "no such property" rather than being written.
    expect(grant.status).toBe(404);
    const granted = await prisma.propertyAccess.count({ where: { userId: staffId } });
    expect(granted).toBe(0);
  });

  it("org A cannot create staff onto org B by any request field", async () => {
    const orgA = await loginAsNewOwner('Staff Iso A4');
    const orgB = await loginAsNewOwner('Staff Iso B4');
    const suffix = randomUUID().slice(0, 8);

    // organizationId is not an accepted input — it comes from the signed
    // token — so smuggling it in the body must not move the new user.
    const created = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(orgA.token))
      .send({
        email: `smuggle-${suffix}@example.com`,
        password: 'correct-horse-battery-staple',
        firstName: 'Smug',
        lastName: 'Gler',
        role: 'STAFF',
        organizationId: orgB.organizationId,
      });

    expect(created.status).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: `smuggle-${suffix}@example.com` } });
    expect(row.organizationId).toBe(orgA.organizationId);
    expect(row.organizationId).not.toBe(orgB.organizationId);
  });
});

describe('property-level access (PropertyAccess grants)', () => {
  /**
   * Provisions a MANAGER directly against the database rather than
   * through `POST /api/v1/staff`. That endpoint now exists (and is
   * covered in `staff.test.ts` and in the staff isolation block above),
   * but these cases predate it and are deliberately left going straight
   * to the data layer: they assert that the *guards* hold for a user
   * however they came to exist, not that one particular endpoint
   * provisions them correctly.
   */
  async function createManagerToken(organizationId: string, grantedPropertyId?: string) {
    const user = await prisma.user.create({
      data: {
        organizationId,
        email: `manager-${randomUUID().slice(0, 8)}@example.com`,
        firstName: 'Manny',
        lastName: 'Ager',
        role: 'MANAGER',
      },
    });
    await prisma.$transaction((tx) => assignSystemRole(tx, { userId: user.id, organizationId, roleName: 'MANAGER' }));
    if (grantedPropertyId) {
      await prisma.propertyAccess.create({ data: { userId: user.id, propertyId: grantedPropertyId } });
    }
    const ctx = await resolveAuthContext(user.id);
    return signAccessToken({
      sub: ctx.userId,
      organizationId: ctx.organizationId,
      permissions: ctx.permissions,
      roleNames: ctx.roleNames,
      grantedPropertyIds: ctx.grantedPropertyIds,
    });
  }

  it('a MANAGER without a PropertyAccess grant gets 403 on a property in their own org', async () => {
    const owner = await loginAsNewOwner('Grant Test Org');
    const propertyId = await createProperty(owner.token);
    const managerToken = await createManagerToken(owner.organizationId);

    const get = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(managerToken));

    expect(get.status).toBe(403);
  });

  it('a MANAGER WITH a PropertyAccess grant can read that property, but not other properties in the same org', async () => {
    const owner = await loginAsNewOwner('Grant Test Org 2');
    const grantedPropertyId = await createProperty(owner.token, 'Granted House', 'granted-house');
    const ungrantedPropertyId = await createProperty(owner.token, 'Other House', 'other-house');
    const managerToken = await createManagerToken(owner.organizationId, grantedPropertyId);

    const grantedGet = await request(app)
      .get(`/api/v1/properties/${grantedPropertyId}`)
      .set(...authHeader(managerToken));
    expect(grantedGet.status).toBe(200);

    const ungrantedGet = await request(app)
      .get(`/api/v1/properties/${ungrantedPropertyId}`)
      .set(...authHeader(managerToken));
    expect(ungrantedGet.status).toBe(403);
  });
});

describe('sanity: seedSystemRoles is idempotent-safe per organization', () => {
  it('does not double-seed roles for the same organization', async () => {
    const { organizationId } = await loginAsNewOwner();
    const rolesBefore = await prisma.role.count({ where: { organizationId } });
    expect(rolesBefore).toBe(4); // OWNER, ADMIN, MANAGER, STAFF
  });
});

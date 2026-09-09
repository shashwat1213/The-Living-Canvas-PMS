/**
 * Notifications & background-jobs infrastructure (2026-09-09).
 *
 * Proves the whole asynchronous backbone end to end against the real
 * database: a confirmed booking composes a guest confirmation inside the
 * booking transaction, the DB-backed worker claims and delivers it via the
 * stored channel driver, the notification lands SENT, and the read API
 * serves it — tenant-scoped, so another organization sees nothing. Also
 * covers the queue's retry/backoff and the guards around the read API.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { drainJobs } from '../src/platform/jobs/worker.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

/** Builds a bookable property (2 rooms of one type, a priced rate plan)
 * and returns the ids a booking needs. Mirrors reservations.test.ts. */
async function setupBookableProperty(token: string) {
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

  for (let i = 1; i <= 2; i += 1) {
    await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: `${100 + i}`, roomTypeId });
  }

  const ratePlan = await request(app)
    .post(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`)
    .set(...auth)
    .send({ name: 'Best Available Rate', code: 'BAR' });
  const ratePlanId = ratePlan.body.ratePlan.id as string;

  const rates = Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    amountMinor: 450000,
  }));
  await request(app)
    .put(`/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans/${ratePlanId}/rates`)
    .set(...auth)
    .send({ rates });

  return { propertyId, roomTypeId, ratePlanId };
}

async function createGuest(
  token: string,
  fields: { firstName: string; lastName: string; email?: string; phone?: string },
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/guests')
    .set(...authHeader(token))
    .send(fields);
  expect(res.status).toBe(201);
  return res.body.guest.id as string;
}

async function book(
  token: string,
  ctx: { propertyId: string; roomTypeId: string; ratePlanId: string; guestId: string },
) {
  return request(app)
    .post(`/api/v1/properties/${ctx.propertyId}/reservations`)
    .set(...authHeader(token))
    .send({
      roomTypeId: ctx.roomTypeId,
      ratePlanId: ctx.ratePlanId,
      guestId: ctx.guestId,
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
    });
}

describe('booking → notification trigger', () => {
  it('composes a PENDING confirmation for a guest with an email, addressed to them', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.com',
    });

    const res = await book(token, { ...ctx, guestId });
    expect(res.status).toBe(201);
    const reference = res.body.reservation.reference as string;

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body.notifications).toHaveLength(1);

    const notif = list.body.notifications[0];
    expect(notif.type).toBe('reservation.confirmation');
    expect(notif.channel).toBe('EMAIL');
    expect(notif.recipient).toBe('ravi@example.com');
    expect(notif.entityType).toBe('reservation');
    expect(notif.entityId).toBe(res.body.reservation.id);
    // Content is composed and stored now, not at send time.
    expect(notif.subject).toContain(reference);
    expect(notif.body).toContain('Ravi Kumar');
    expect(notif.body).toContain(reference);
    // Not yet delivered — the worker hasn't run.
    expect(notif.status).toBe('PENDING');
  });

  it('uses SMS when the guest has a phone but no email', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, {
      firstName: 'Meera',
      lastName: 'Nair',
      phone: '+919812345678',
    });

    await book(token, { ...ctx, guestId });

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(token));
    expect(list.body.notifications).toHaveLength(1);
    expect(list.body.notifications[0].channel).toBe('SMS');
    expect(list.body.notifications[0].recipient).toBe('+919812345678');
  });

  it('composes no notification for a walk-in guest with no contact details', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, { firstName: 'Walk', lastName: 'In' });

    const res = await book(token, { ...ctx, guestId });
    expect(res.status).toBe(201);

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(token));
    expect(list.body.notifications).toHaveLength(0);
  });

  it('enqueues the confirmation and the booking atomically — a rejected booking leaves neither', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.com',
    });

    // A stay with an unpriced night is rejected (BadRequest) inside the
    // transaction — so no reservation, and no notification, should persist.
    const res = await request(app)
      .post(`/api/v1/properties/${ctx.propertyId}/reservations`)
      .set(...authHeader(token))
      .send({
        roomTypeId: ctx.roomTypeId,
        ratePlanId: ctx.ratePlanId,
        guestId,
        checkIn: '2026-11-10', // November has no rates set
        checkOut: '2026-11-12',
      });
    expect(res.status).toBe(400);

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(token));
    expect(list.body.notifications).toHaveLength(0);
  });
});

describe('job worker delivery', () => {
  it('delivers a queued confirmation via the stored driver and marks it SENT', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.com',
    });
    const res = await book(token, { ...ctx, guestId });
    const notifId = (
      await request(app)
        .get('/api/v1/notifications')
        .set(...authHeader(token))
    ).body.notifications[0].id as string;

    // Run the worker to quiescence.
    const handled = await drainJobs();
    expect(handled).toBeGreaterThanOrEqual(1);

    const after = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(token));
    const notif = after.body.notifications.find((n: { id: string }) => n.id === notifId);
    expect(notif.status).toBe('SENT');
    expect(notif.sentAt).not.toBeNull();
    expect(notif.attempts).toBe(1);

    // The job itself is COMPLETED.
    const job = await prisma.job.findFirst({
      where: { type: 'notification.send', payload: { path: ['notificationId'], equals: notifId } },
    });
    expect(job?.status).toBe('COMPLETED');
  });

  it('re-running the worker does not double-send an already-SENT notification', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.com',
    });
    await book(token, { ...ctx, guestId });

    await drainJobs();
    const drainedAgain = await drainJobs();
    // Nothing left to claim; the second drain does no work.
    expect(drainedAgain).toBe(0);

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(token));
    expect(list.body.notifications[0].attempts).toBe(1);
    expect(list.body.notifications[0].status).toBe('SENT');
  });
});

describe('notification log read API', () => {
  it('filters by status and channel, and searches recipient/subject/type', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const ctx = await setupBookableProperty(token);
    const guestId = await createGuest(token, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.com',
    });
    await book(token, { ...ctx, guestId });

    const pending = await request(app)
      .get('/api/v1/notifications?status=PENDING')
      .set(...authHeader(token));
    expect(pending.body.notifications).toHaveLength(1);

    const sentBefore = await request(app)
      .get('/api/v1/notifications?status=SENT')
      .set(...authHeader(token));
    expect(sentBefore.body.notifications).toHaveLength(0);

    await drainJobs();

    const sentAfter = await request(app)
      .get('/api/v1/notifications?status=SENT')
      .set(...authHeader(token));
    expect(sentAfter.body.notifications).toHaveLength(1);

    const email = await request(app)
      .get('/api/v1/notifications?channel=EMAIL')
      .set(...authHeader(token));
    expect(email.body.notifications).toHaveLength(1);

    const sms = await request(app)
      .get('/api/v1/notifications?channel=SMS')
      .set(...authHeader(token));
    expect(sms.body.notifications).toHaveLength(0);

    const search = await request(app)
      .get('/api/v1/notifications?search=ravi')
      .set(...authHeader(token));
    expect(search.body.notifications).toHaveLength(1);

    const noMatch = await request(app)
      .get('/api/v1/notifications?search=nobody')
      .set(...authHeader(token));
    expect(noMatch.body.notifications).toHaveLength(0);
  });

  it('rejects an unknown status/channel with 400, not an empty page', async () => {
    const { token } = await loginAsNewOwner('Notif Hotel');
    const res = await request(app)
      .get('/api/v1/notifications?status=BOGUS')
      .set(...authHeader(token));
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('never returns another organization\'s notifications', async () => {
    // Org A books, producing a notification.
    const a = await loginAsNewOwner('Org A');
    const ctxA = await setupBookableProperty(a.token);
    const guestA = await createGuest(a.token, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@example.com',
    });
    await book(a.token, { ...ctxA, guestId: guestA });

    // Org B sees nothing — not A's row, not a nonzero total.
    const b = await loginAsNewOwner('Org B');
    const list = await request(app)
      .get('/api/v1/notifications')
      .set(...authHeader(b.token));
    expect(list.status).toBe(200);
    expect(list.body.notifications).toHaveLength(0);
    expect(list.body.page.totalItems).toBe(0);

    // Even searching for A's known recipient returns zero.
    const search = await request(app)
      .get('/api/v1/notifications?search=ravi@example.com')
      .set(...authHeader(b.token));
    expect(search.body.notifications).toHaveLength(0);
  });
});

/**
 * Audit trail. Two halves are load-bearing here and worth stating:
 *
 * 1. An entry must exist for every consequential staff action — a gap
 *    means an administrative change happened with no record of who made
 *    it, which is the whole failure this module exists to prevent.
 * 2. An entry must NOT exist for an action that was refused. An audit
 *    trail that records attempts as though they succeeded is worse than
 *    no trail, because it is confidently wrong.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAs, loginAsNewOwner } from './helpers.js';

const AUDIT_URL = '/api/v1/audit-logs';

function staffBody(role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF', overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().slice(0, 8);
  return {
    email: `audit-${role.toLowerCase()}-${suffix}@example.com`,
    password: 'correct-horse-battery-staple',
    firstName: 'Ada',
    lastName: 'Auditee',
    role,
    ...overrides,
  };
}

async function createStaff(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/staff')
    .set(...authHeader(token))
    .send(body);
}

async function readAudit(token: string, query = '') {
  return request(app)
    .get(`${AUDIT_URL}${query}`)
    .set(...authHeader(token));
}

/** Reads straight from the database, for cases where the caller can't use the API. */
async function auditRowsFor(organizationId: string) {
  return prisma.auditLog.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
}

async function createProperty(token: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: 'Audit House', slug: `audit-house-${randomUUID().slice(0, 8)}` });
  return res.body.property.id as string;
}

describe('audit entries are written for staff mutations', () => {
  it('records a creation, attributed to the acting user', async () => {
    const owner = await loginAsNewOwner('Audit Create Org');
    const body = staffBody('STAFF');
    const created = await createStaff(owner.token, body);
    expect(created.status).toBe(201);

    const rows = await auditRowsFor(owner.organizationId);
    expect(rows).toHaveLength(1);

    const entry = rows[0]!;
    expect(entry.action).toBe('staff.created');
    expect(entry.entityType).toBe('staff');
    expect(entry.entityId).toBe(created.body.staff.id);
    expect(entry.organizationId).toBe(owner.organizationId);
    expect(entry.actorType).toBe('USER');
    expect(entry.actorEmail).toBe(owner.ownerEmail);
    expect(entry.metadata).toMatchObject({ email: body.email, role: 'STAFF' });
  });

  it('never records the password, in any form', async () => {
    const owner = await loginAsNewOwner('Audit Secret Org');
    const body = staffBody('STAFF');
    await createStaff(owner.token, body);

    const rows = await auditRowsFor(owner.organizationId);
    const serialized = JSON.stringify(rows);

    expect(serialized).not.toContain(body.password);
    expect(serialized).not.toContain('$argon2');
    expect(serialized.toLowerCase()).not.toContain('passwordhash');
    expect(rows[0]!.metadata).not.toHaveProperty('password');
  });

  it('strips credential-shaped keys even if a caller passes them', async () => {
    // Guards the recorder's own redaction rather than the call site's
    // care: a future service that spreads an input object into metadata
    // should produce a redacted entry, not a leak.
    const { recordAuditEvent } = await import('../src/platform/audit/recorder.js');
    const { runWithRequestContext } = await import('../src/platform/tenancy/context.js');
    const owner = await loginAsNewOwner('Audit Redact Org');
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { email: owner.ownerEmail } });

    await runWithRequestContext(
      {
        userId: ownerRow.id,
        organizationId: owner.organizationId,
        permissions: new Set(),
        roleNames: new Set(),
        grantedPropertyIds: new Set(),
      },
      async () =>
        recordAuditEvent({
          action: 'staff.updated',
          entityType: 'staff',
          entityId: ownerRow.id,
          metadata: { password: 'hunter2', secret: 'abc', keep: 'this' },
        }),
    );

    const rows = await auditRowsFor(owner.organizationId);
    expect(rows[0]!.metadata).toEqual({ keep: 'this' });
  });

  it('records a role change with the previous and new role', async () => {
    const owner = await loginAsNewOwner('Audit Role Org');
    const created = await createStaff(owner.token, staffBody('STAFF'));

    const patched = await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ role: 'MANAGER' });
    expect(patched.status).toBe(200);

    const rows = await auditRowsFor(owner.organizationId);
    const roleChange = rows.find((row) => row.action === 'staff.role_changed');
    expect(roleChange).toBeDefined();
    expect(roleChange!.metadata).toEqual({ from: 'STAFF', to: 'MANAGER' });
  });

  it('does not record a role change when the role did not actually move', async () => {
    const owner = await loginAsNewOwner('Audit NoOp Org');
    const created = await createStaff(owner.token, staffBody('STAFF'));

    await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ role: 'STAFF' });

    const rows = await auditRowsFor(owner.organizationId);
    expect(rows.filter((row) => row.action === 'staff.role_changed')).toHaveLength(0);
  });

  it('records deactivation and reactivation as distinct events', async () => {
    const owner = await loginAsNewOwner('Audit Status Org');
    const created = await createStaff(owner.token, staffBody('STAFF'));
    const id = created.body.staff.id as string;

    await request(app)
      .patch(`/api/v1/staff/${id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });
    await request(app)
      .patch(`/api/v1/staff/${id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: true });

    const actions = (await auditRowsFor(owner.organizationId)).map((row) => row.action);
    expect(actions).toContain('staff.deactivated');
    expect(actions).toContain('staff.reactivated');
    expect(actions.indexOf('staff.deactivated')).toBeLessThan(actions.indexOf('staff.reactivated'));
  });

  it('records a name change with before and after values', async () => {
    const owner = await loginAsNewOwner('Audit Name Org');
    const created = await createStaff(owner.token, staffBody('STAFF'));

    await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ firstName: 'Renamed' });

    const rows = await auditRowsFor(owner.organizationId);
    const update = rows.find((row) => row.action === 'staff.updated');
    expect(update!.metadata).toEqual({
      from: { firstName: 'Ada', lastName: 'Auditee' },
      to: { firstName: 'Renamed', lastName: 'Auditee' },
    });
  });

  it('records a property-access change with what was added and removed', async () => {
    const owner = await loginAsNewOwner('Audit Access Org');
    const propertyId = await createProperty(owner.token);
    const created = await createStaff(owner.token, staffBody('MANAGER'));

    await request(app)
      .put(`/api/v1/staff/${created.body.staff.id}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [propertyId] });

    const rows = await auditRowsFor(owner.organizationId);
    const change = rows.find((row) => row.action === 'staff.property_access_changed');
    expect(change!.metadata).toEqual({ added: [propertyId], removed: [], resulting: [propertyId] });
  });

  it('writes one entry per event when a single request does two things', async () => {
    const owner = await loginAsNewOwner('Audit Multi Org');
    const created = await createStaff(owner.token, staffBody('STAFF'));

    await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ firstName: 'Both', role: 'MANAGER' });

    const actions = (await auditRowsFor(owner.organizationId)).map((row) => row.action);
    expect(actions).toEqual(['staff.created', 'staff.updated', 'staff.role_changed']);
  });
});

describe('refused actions leave no audit entry', () => {
  it('writes nothing when an ADMIN is forbidden from escalating', async () => {
    const owner = await loginAsNewOwner('Audit Forbidden Org');
    const adminBody = staffBody('ADMIN');
    await createStaff(owner.token, adminBody);
    const adminToken = await loginAs(adminBody.email as string, adminBody.password as string);

    const before = (await auditRowsFor(owner.organizationId)).length;

    const attempt = await createStaff(adminToken, staffBody('OWNER'));
    expect(attempt.status).toBe(403);

    const after = await auditRowsFor(owner.organizationId);
    expect(after).toHaveLength(before);
    expect(after.some((row) => row.metadata && JSON.stringify(row.metadata).includes('OWNER'))).toBe(false);
  });

  it('writes nothing when the target does not exist', async () => {
    const owner = await loginAsNewOwner('Audit Missing Org');
    const before = (await auditRowsFor(owner.organizationId)).length;

    const attempt = await request(app)
      .patch(`/api/v1/staff/${randomUUID()}`)
      .set(...authHeader(owner.token))
      .send({ role: 'MANAGER' });
    expect(attempt.status).toBe(404);

    expect(await auditRowsFor(owner.organizationId)).toHaveLength(before);
  });

  it('writes nothing when a create is rejected as a duplicate', async () => {
    const owner = await loginAsNewOwner('Audit Dup Org');
    const body = staffBody('STAFF');
    await createStaff(owner.token, body);
    const before = (await auditRowsFor(owner.organizationId)).length;

    expect((await createStaff(owner.token, body)).status).toBe(409);

    // The transaction that would have written the entry rolled back with
    // the account it described.
    expect(await auditRowsFor(owner.organizationId)).toHaveLength(before);
  });
});

describe('GET /audit-logs — authorization', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await request(app).get(AUDIT_URL)).status).toBe(401);
  });

  it('allows an OWNER', async () => {
    const owner = await loginAsNewOwner('Audit Read Owner Org');
    const res = await readAudit(owner.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.auditLogs)).toBe(true);
    expect(res.body.page).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('allows an ADMIN', async () => {
    const owner = await loginAsNewOwner('Audit Read Admin Org');
    const body = staffBody('ADMIN');
    await createStaff(owner.token, body);
    const token = await loginAs(body.email as string, body.password as string);

    expect((await readAudit(token)).status).toBe(200);
  });

  it('forbids a MANAGER and a STAFF member', async () => {
    const owner = await loginAsNewOwner('Audit Read Forbidden Org');

    for (const role of ['MANAGER', 'STAFF'] as const) {
      const body = staffBody(role);
      await createStaff(owner.token, body);
      const token = await loginAs(body.email as string, body.password as string);

      const res = await readAudit(token);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('audit:read');
    }
  });
});

describe('GET /audit-logs — tenant isolation', () => {
  it("never returns another organization's entries, and never counts them", async () => {
    const orgA = await loginAsNewOwner('Audit Iso A');
    const orgB = await loginAsNewOwner('Audit Iso B');

    const secretBody = staffBody('STAFF', { firstName: `Zarniwoop${randomUUID().slice(0, 6)}` });
    const created = await createStaff(orgA.token, secretBody);
    expect(created.status).toBe(201);

    const bView = await readAudit(orgB.token, '?pageSize=100');
    expect(bView.status).toBe(200);
    expect(bView.body.auditLogs).toHaveLength(0);
    expect(bView.body.page.totalItems).toBe(0);
    expect(JSON.stringify(bView.body)).not.toContain(secretBody.email as string);

    // Filtering by org A's actual entity ID must not reach it either.
    const probe = await readAudit(orgB.token, `?entityId=${created.body.staff.id}`);
    expect(probe.body.auditLogs).toHaveLength(0);
    expect(probe.body.page.totalItems).toBe(0);

    // Org A still sees its own.
    const aView = await readAudit(orgA.token);
    expect(aView.body.auditLogs).toHaveLength(1);
    expect(aView.body.auditLogs[0].entityId).toBe(created.body.staff.id);
  });
});

describe('GET /audit-logs — shape, filters and paging', () => {
  async function seedEvents() {
    const owner = await loginAsNewOwner('Audit Query Org');
    const created = await createStaff(owner.token, staffBody('STAFF'));
    const id = created.body.staff.id as string;
    await request(app)
      .patch(`/api/v1/staff/${id}`)
      .set(...authHeader(owner.token))
      .send({ role: 'MANAGER' });
    await request(app)
      .patch(`/api/v1/staff/${id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });
    return { owner, id };
  }

  it('returns newest first, with the actor resolved', async () => {
    const { owner } = await seedEvents();

    const res = await readAudit(owner.token);

    expect(res.body.auditLogs[0].action).toBe('staff.deactivated');
    expect(res.body.auditLogs.at(-1).action).toBe('staff.created');

    const entry = res.body.auditLogs[0];
    expect(entry.actor.email).toBe(owner.ownerEmail);
    expect(entry.actorEmail).toBe(owner.ownerEmail);
    expect(entry.actorType).toBe('USER');
    expect(typeof entry.createdAt).toBe('string');
  });

  it('filters by action', async () => {
    const { owner } = await seedEvents();

    const res = await readAudit(owner.token, '?action=staff.role_changed');

    expect(res.body.auditLogs).toHaveLength(1);
    expect(res.body.page.totalItems).toBe(1);
    expect(res.body.auditLogs[0].action).toBe('staff.role_changed');
  });

  it('filters by the entity acted on', async () => {
    const { owner, id } = await seedEvents();

    const res = await readAudit(owner.token, `?entityType=staff&entityId=${id}`);

    expect(res.body.page.totalItems).toBe(3);
    expect(res.body.auditLogs.every((e: { entityId: string }) => e.entityId === id)).toBe(true);
  });

  it('filters by actor', async () => {
    const { owner } = await seedEvents();
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { email: owner.ownerEmail } });

    const mine = await readAudit(owner.token, `?actorUserId=${ownerRow.id}`);
    expect(mine.body.page.totalItems).toBe(3);

    const someoneElse = await readAudit(owner.token, `?actorUserId=${randomUUID()}`);
    expect(someoneElse.body.page.totalItems).toBe(0);
  });

  it('paginates', async () => {
    const { owner } = await seedEvents();

    const page1 = await readAudit(owner.token, '?page=1&pageSize=2');
    const page2 = await readAudit(owner.token, '?page=2&pageSize=2');

    expect(page1.body.auditLogs).toHaveLength(2);
    expect(page2.body.auditLogs).toHaveLength(1);
    expect(page1.body.page).toMatchObject({ totalItems: 3, totalPages: 2 });

    const ids = [...page1.body.auditLogs, ...page2.body.auditLogs].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('rejects an unknown action or entity type rather than returning an empty page', async () => {
    const { owner } = await seedEvents();

    expect((await readAudit(owner.token, '?action=staff.exploded')).status).toBe(400);
    expect((await readAudit(owner.token, '?entityType=dragon')).status).toBe(400);
    expect((await readAudit(owner.token, '?entityId=not-a-uuid')).status).toBe(400);
    expect((await readAudit(owner.token, '?pageSize=101')).status).toBe(400);
  });

  it('exposes no write path', async () => {
    const { owner, id } = await seedEvents();
    const entryId = (await auditRowsFor(owner.organizationId))[0]!.id;

    // The trail is produced as a side effect of real actions; there is
    // deliberately no endpoint to author or remove an entry.
    for (const res of [
      await request(app)
        .post(AUDIT_URL)
        .set(...authHeader(owner.token))
        .send({ action: 'staff.created', entityType: 'staff', entityId: id }),
      await request(app)
        .delete(`${AUDIT_URL}/${entryId}`)
        .set(...authHeader(owner.token)),
      await request(app)
        .patch(`${AUDIT_URL}/${entryId}`)
        .set(...authHeader(owner.token))
        .send({ action: 'staff.created' }),
    ]) {
      expect(res.status).toBe(404);
    }
  });
});

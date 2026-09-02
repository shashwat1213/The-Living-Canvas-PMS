/**
 * Atomicity of the audit trail, and the architectural assumption it rests on.
 *
 * Every mutating service now writes its audit entry inside the same
 * transaction as the change it describes. Two things have to hold for
 * that to be worth anything, and neither is visible from the outside:
 *
 * 1. The tenant-scoping Prisma extension must still apply *inside* a
 *    `$transaction`. If a Prisma upgrade ever changed that, every
 *    transactional mutation would silently lose its organization filter —
 *    a total tenancy failure with no failing test anywhere else.
 * 2. A failed audit write must roll the mutation back, not leave it
 *    committed and unrecorded.
 *
 * The rollback cases mock `recordAuditEvent` to throw, which is the only
 * way to exercise "the audit write failed" without corrupting the
 * database. This file is mocked at module scope, so it is deliberately
 * separate from `audit.test.ts`, which needs the real recorder.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/audit/recorder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/platform/audit/recorder.js')>();
  return {
    ...actual,
    recordAuditEvent: vi.fn(actual.recordAuditEvent),
  };
});

import { prisma } from '../src/lib/prisma.js';
import { recordAuditEvent } from '../src/platform/audit/recorder.js';
import { runWithRequestContext } from '../src/platform/tenancy/context.js';
import { scopedPrisma } from '../src/platform/tenancy/scoped-prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

const mockedRecord = vi.mocked(recordAuditEvent);

/** Makes the next audit write fail, as a transient database error would. */
function failNextAuditWrite() {
  mockedRecord.mockRejectedValueOnce(new Error('simulated audit write failure'));
}

beforeEach(() => {
  mockedRecord.mockClear();
});

describe('tenant scoping survives inside a transaction', () => {
  it('applies the organization filter to queries issued on a transaction client', async () => {
    const owner = await loginAsNewOwner('Tx Scoping Org');
    await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Scoped House', slug: `scoped-${randomUUID().slice(0, 8)}` });

    const unscopedTotal = await prisma.property.count();

    const scopedTotal = await runWithRequestContext(
      {
        userId: 'unused-for-this-query',
        organizationId: owner.organizationId,
        permissions: new Set(),
        roleNames: new Set(),
        grantedPropertyIds: new Set(),
      },
      () => scopedPrisma.$transaction(async (tx) => tx.property.count()),
    );

    // The fresh organization has exactly the one property just created,
    // while the shared test database holds many. If the extension ever
    // stopped propagating into transactions these would be equal, and
    // every transactional mutation in the app would be cross-tenant.
    expect(scopedTotal).toBe(1);
    expect(unscopedTotal).toBeGreaterThan(1);
  });

  it('injects the organization on writes issued on a transaction client', async () => {
    const owner = await loginAsNewOwner('Tx Write Scoping Org');
    const slug = `tx-write-${randomUUID().slice(0, 8)}`;

    const created = await runWithRequestContext(
      {
        userId: 'unused-for-this-query',
        organizationId: owner.organizationId,
        permissions: new Set(),
        roleNames: new Set(),
        grantedPropertyIds: new Set(),
      },
      () =>
        scopedPrisma.$transaction(async (tx) =>
          // `organizationId` is deliberately absent from the payload — the
          // extension supplies it. If it stopped, this would fail on a
          // NOT NULL constraint rather than land in the wrong tenant.
          tx.property.create({ data: { name: 'Tx Written', slug } as never }),
        ),
    );

    expect(created.organizationId).toBe(owner.organizationId);
  });
});

describe('a failed audit write rolls the mutation back', () => {
  it('property creation leaves no property behind', async () => {
    const owner = await loginAsNewOwner('Rollback Create Org');
    const slug = `rollback-${randomUUID().slice(0, 8)}`;
    failNextAuditWrite();

    const res = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Should Not Persist', slug });

    expect(res.status).toBe(500);
    expect(await prisma.property.findFirst({ where: { slug } })).toBeNull();
  });

  it('property update leaves the original values intact', async () => {
    const owner = await loginAsNewOwner('Rollback Update Org');
    const created = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Original', slug: `rollback-u-${randomUUID().slice(0, 8)}` });
    const id = created.body.property.id as string;

    failNextAuditWrite();
    const res = await request(app)
      .patch(`/api/v1/properties/${id}`)
      .set(...authHeader(owner.token))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(500);
    const after = await prisma.property.findUniqueOrThrow({ where: { id } });
    expect(after.name).toBe('Original');
  });

  it('property deletion leaves the property in place', async () => {
    const owner = await loginAsNewOwner('Rollback Delete Org');
    const created = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Survivor', slug: `rollback-d-${randomUUID().slice(0, 8)}` });
    const id = created.body.property.id as string;

    failNextAuditWrite();
    const res = await request(app)
      .delete(`/api/v1/properties/${id}`)
      .set(...authHeader(owner.token));

    expect(res.status).toBe(500);
    expect(await prisma.property.findUnique({ where: { id } })).not.toBeNull();
  });

  it('room creation leaves no room behind', async () => {
    const owner = await loginAsNewOwner('Rollback Room Org');
    const property = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Room Host', slug: `rollback-r-${randomUUID().slice(0, 8)}` });
    const propertyId = property.body.property.id as string;

    failNextAuditWrite();
    const res = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(owner.token))
      .send({ name: '999', roomType: 'Ghost' });

    expect(res.status).toBe(500);
    expect(await prisma.room.findFirst({ where: { propertyId, name: '999' } })).toBeNull();
  });

  it('staff deactivation leaves the account active and its sessions live', async () => {
    // The case this fix exists for: deactivation composes a user update
    // and a session revoke. Both must roll back with the audit entry, or
    // someone ends up locked out with no record of who did it.
    const owner = await loginAsNewOwner('Rollback Deactivate Org');
    const email = `rollback-${randomUUID().slice(0, 8)}@example.com`;
    const created = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(owner.token))
      .send({ email, password: 'correct-horse-battery-staple', firstName: 'Rolls', lastName: 'Back', role: 'STAFF' });
    const staffId = created.body.staff.id as string;

    // Give them a live session, so the revoke has something to undo.
    await request(app).post('/api/v1/auth/login').send({ email, password: 'correct-horse-battery-staple' });
    const sessionsBefore = await prisma.session.count({ where: { userId: staffId, revokedAt: null } });
    expect(sessionsBefore).toBeGreaterThan(0);

    failNextAuditWrite();
    const res = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });

    expect(res.status).toBe(500);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(user.isActive).toBe(true);
    expect(user.tokensValidAfter).toBeNull();
    expect(await prisma.session.count({ where: { userId: staffId, revokedAt: null } })).toBe(sessionsBefore);

    // And they can still sign in, which is the user-visible proof.
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct-horse-battery-staple' });
    expect(relogin.status).toBe(200);
  });

  it('leaves no orphan audit entry when the mutation itself fails', async () => {
    const owner = await loginAsNewOwner('Rollback Orphan Org');
    const before = await prisma.auditLog.count({ where: { organizationId: owner.organizationId } });

    const res = await request(app)
      .patch(`/api/v1/properties/${randomUUID()}`)
      .set(...authHeader(owner.token))
      .send({ name: 'Nope' });

    expect(res.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { organizationId: owner.organizationId } })).toBe(before);
  });
});

describe('the happy path still commits both halves', () => {
  it('writes the property and its audit entry together', async () => {
    const owner = await loginAsNewOwner('Commit Both Org');
    const slug = `commit-${randomUUID().slice(0, 8)}`;

    const res = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Committed', slug });

    expect(res.status).toBe(201);
    expect(await prisma.property.findFirst({ where: { slug } })).not.toBeNull();

    const entries = await prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId, action: 'property.created' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entityId).toBe(res.body.property.id);
  });
});

/**
 * Role and property-access changes additionally invalidate the target's
 * access token (`bumpTokensValidAfter`), because the token embeds the
 * permission list and the granted-property list. That bump is what
 * actually takes the old authority away, so it has to commit with the
 * change rather than after it: a role change that persisted without its
 * bump would leave the user holding permissions they no longer have for
 * up to a token lifetime, while the audit trail said otherwise.
 */
describe('role and property-access changes invalidate the token in the same transaction', () => {
  async function seedStaff(orgLabel: string) {
    const owner = await loginAsNewOwner(orgLabel);
    const email = `rpa-${randomUUID().slice(0, 8)}@example.com`;
    const created = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(owner.token))
      .send({ email, password: 'correct-horse-battery-staple', firstName: 'Ria', lastName: 'Pace', role: 'STAFF' });
    return { owner, email, staffId: created.body.staff.id as string };
  }

  async function createProperty(token: string) {
    const res = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(token))
      .send({ name: 'Access House', slug: `access-${randomUUID().slice(0, 8)}` });
    return res.body.property.id as string;
  }

  it('a committed role change always carries its watermark bump', async () => {
    const { owner, staffId } = await seedStaff('RPA Commit Org');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).tokensValidAfter).toBeNull();

    const res = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set(...authHeader(owner.token))
      .send({ role: 'MANAGER' });

    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(after.role).toBe('MANAGER');
    expect(after.tokensValidAfter).not.toBeNull();
  });

  it('a rolled-back role change leaves the watermark untouched', async () => {
    // The guarantee under test: the bump is inside the transaction, so a
    // failure anywhere in it takes the bump with it. If the bump ran
    // outside, this user would end up with a watermark — and a
    // needlessly invalidated session — for a change that never happened.
    const { owner, staffId } = await seedStaff('RPA Rollback Org');
    failNextAuditWrite();

    const res = await request(app)
      .patch(`/api/v1/staff/${staffId}`)
      .set(...authHeader(owner.token))
      .send({ role: 'MANAGER' });

    expect(res.status).toBe(500);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(after.role).toBe('STAFF');
    expect(after.tokensValidAfter).toBeNull();
    expect(await prisma.userRoleAssignment.count({ where: { userId: staffId } })).toBe(1);
  });

  it('a committed property-access change always carries its watermark bump', async () => {
    const { owner, staffId } = await seedStaff('RPA Access Commit Org');
    const propertyId = await createProperty(owner.token);

    const res = await request(app)
      .put(`/api/v1/staff/${staffId}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [propertyId] });

    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(after.tokensValidAfter).not.toBeNull();
    expect(await prisma.propertyAccess.count({ where: { userId: staffId } })).toBe(1);
  });

  it('a rolled-back property-access change leaves both the grants and the watermark untouched', async () => {
    const { owner, staffId } = await seedStaff('RPA Access Rollback Org');
    const propertyId = await createProperty(owner.token);
    failNextAuditWrite();

    const res = await request(app)
      .put(`/api/v1/staff/${staffId}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [propertyId] });

    expect(res.status).toBe(500);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(after.tokensValidAfter).toBeNull();
    expect(await prisma.propertyAccess.count({ where: { userId: staffId } })).toBe(0);
  });

  it('a cross-tenant attempt changes nothing and bumps nothing', async () => {
    const orgA = await seedStaff('RPA Iso A');
    const orgB = await loginAsNewOwner('RPA Iso B');

    const roleAttempt = await request(app)
      .patch(`/api/v1/staff/${orgA.staffId}`)
      .set(...authHeader(orgB.token))
      .send({ role: 'MANAGER' });
    expect(roleAttempt.status).toBe(404);

    const accessAttempt = await request(app)
      .put(`/api/v1/staff/${orgA.staffId}/property-access`)
      .set(...authHeader(orgB.token))
      .send({ propertyIds: [] });
    expect(accessAttempt.status).toBe(404);

    // Neither the role, the grants, nor the watermark moved — the refusal
    // happens on a tenant-scoped read before any transaction opens.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: orgA.staffId } });
    expect(after.role).toBe('STAFF');
    expect(after.tokensValidAfter).toBeNull();
  });
});

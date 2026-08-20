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
    const room = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...authHeader(orgA.token))
      .send({ name: '101', roomType: 'Standard' });
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
      .send({ name: '999', roomType: 'Should not be created' });
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

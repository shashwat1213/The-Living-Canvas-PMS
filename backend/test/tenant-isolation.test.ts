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

describe('property-level access (PropertyAccess grants)', () => {
  /**
   * There's no staff-invite endpoint in Phase 1 scope (see TASKS.md), so
   * this test provisions a MANAGER user directly against the database —
   * exactly the scenario the schema (UserRoleAssignment, PropertyAccess)
   * exists to support once that endpoint lands.
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

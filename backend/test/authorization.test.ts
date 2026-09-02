/**
 * Standing authorization-matrix regression suite.
 *
 * `tenant-isolation.test.ts` owns the organization boundary. This file
 * owns the layer above it: which *role* may do what, and which
 * *property* they may do it to, inside a single organization. The two
 * failure modes it exists to catch are a property-scoped role reaching a
 * property it was never granted, and an ID swapped in a URL reaching a
 * record under a different parent.
 *
 * Every case drives the real HTTP stack against the real database, so
 * the guards, the request context and the tenant-scoping extension are
 * all genuinely exercised — a mocked authorization check would prove
 * nothing here.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { setPropertyAccess } from '../src/modules/staff/service.js';
import { runWithRequestContext } from '../src/platform/tenancy/context.js';
import { app, authHeader, loginAs, loginAsNewOwner } from './helpers.js';

const PASSWORD = 'correct-horse-battery-staple';

/**
 * One organization containing two properties, a room in each, and one
 * user of every role. MANAGER and STAFF are granted `granted` only —
 * `ungranted` is the property they must never reach.
 */
interface Fixture {
  ownerToken: string;
  ownerEmail: string;
  organizationId: string;
  adminToken: string;
  managerToken: string;
  staffToken: string;
  managerId: string;
  /** A separate target, so grant tests never trip the self-guard. */
  targetStaffId: string;
  granted: string;
  ungranted: string;
  grantedRoom: string;
  ungrantedRoom: string;
}

let fx: Fixture;

async function createProperty(token: string, name: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}` });
  if (res.status !== 201) throw new Error(`property setup failed: ${res.status}`);
  return res.body.property.id as string;
}

async function createRoom(token: string, propertyId: string, name: string) {
  const res = await request(app)
    .post(`/api/v1/properties/${propertyId}/rooms`)
    .set(...authHeader(token))
    .send({ name, roomType: 'Standard' });
  if (res.status !== 201) throw new Error(`room setup failed: ${res.status}`);
  return res.body.room.id as string;
}

async function createRoleUser(ownerToken: string, role: string, propertyIds: string[]) {
  const email = `authz-${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`;
  const res = await request(app)
    .post('/api/v1/staff')
    .set(...authHeader(ownerToken))
    .send({ email, password: PASSWORD, firstName: role, lastName: 'User', role, propertyIds });
  if (res.status !== 201) throw new Error(`${role} setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.staff.id as string, token: await loginAs(email, PASSWORD) };
}

beforeAll(async () => {
  const owner = await loginAsNewOwner('Authorization Matrix Org');
  const granted = await createProperty(owner.token, 'Granted');
  const ungranted = await createProperty(owner.token, 'Ungranted');

  const admin = await createRoleUser(owner.token, 'ADMIN', []);
  const manager = await createRoleUser(owner.token, 'MANAGER', [granted]);
  const staff = await createRoleUser(owner.token, 'STAFF', [granted]);
  const target = await createRoleUser(owner.token, 'STAFF', []);

  fx = {
    ownerToken: owner.token,
    ownerEmail: owner.ownerEmail,
    organizationId: owner.organizationId,
    adminToken: admin.token,
    managerToken: manager.token,
    staffToken: staff.token,
    managerId: manager.id,
    targetStaffId: target.id,
    granted,
    ungranted,
    grantedRoom: await createRoom(owner.token, granted, '101'),
    ungrantedRoom: await createRoom(owner.token, ungranted, '201'),
  };
});

describe('A. authorized role, same organization — allowed', () => {
  it('an org-wide role reaches a property it holds no explicit grant for', async () => {
    for (const token of [fx.ownerToken, fx.adminToken]) {
      const res = await request(app)
        .get(`/api/v1/properties/${fx.ungranted}`)
        .set(...authHeader(token));
      expect(res.status).toBe(200);
    }
  });

  it('a property-scoped role reaches the property it was granted', async () => {
    for (const token of [fx.managerToken, fx.staffToken]) {
      const res = await request(app)
        .get(`/api/v1/properties/${fx.granted}`)
        .set(...authHeader(token));
      expect(res.status).toBe(200);
    }
  });

  it('a STAFF member can update room status at a granted property', async () => {
    const res = await request(app)
      .patch(`/api/v1/properties/${fx.granted}/rooms/${fx.grantedRoom}`)
      .set(...authHeader(fx.staffToken))
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
  });
});

describe('B. unauthorized role, same organization — rejected', () => {
  it('MANAGER and STAFF cannot create a property', async () => {
    for (const token of [fx.managerToken, fx.staffToken]) {
      const res = await request(app)
        .post('/api/v1/properties')
        .set(...authHeader(token))
        .send({ name: 'Nope', slug: `nope-${randomUUID().slice(0, 8)}` });
      expect(res.status).toBe(403);
    }
  });

  it('STAFF cannot update a property it is granted, create a room, or delete one', async () => {
    // Granted access is not the same as permission: STAFF holds
    // `rooms:read`/`rooms:update` but not `properties:update`,
    // `rooms:create` or `rooms:delete`.
    const update = await request(app)
      .patch(`/api/v1/properties/${fx.granted}`)
      .set(...authHeader(fx.staffToken))
      .send({ name: 'Renamed' });
    expect(update.status).toBe(403);

    const create = await request(app)
      .post(`/api/v1/properties/${fx.granted}/rooms`)
      .set(...authHeader(fx.staffToken))
      .send({ name: '999', roomType: 'Ghost' });
    expect(create.status).toBe(403);

    const remove = await request(app)
      .delete(`/api/v1/properties/${fx.granted}/rooms/${fx.grantedRoom}`)
      .set(...authHeader(fx.staffToken));
    expect(remove.status).toBe(403);
  });

  it('MANAGER and STAFF cannot read the audit trail', async () => {
    for (const token of [fx.managerToken, fx.staffToken]) {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set(...authHeader(token));
      expect(res.status).toBe(403);
    }
  });

  it('STAFF cannot read the staff directory', async () => {
    const res = await request(app)
      .get('/api/v1/staff')
      .set(...authHeader(fx.staffToken));
    expect(res.status).toBe(403);
  });

  it('MANAGER and STAFF cannot update the organization', async () => {
    for (const token of [fx.managerToken, fx.staffToken]) {
      const res = await request(app)
        .patch('/api/v1/organizations/me')
        .set(...authHeader(token))
        .send({ name: 'Hijacked Organization' });
      expect(res.status).toBe(403);
    }
  });
});

describe('C. correct role, wrong property — rejected', () => {
  it('a MANAGER is refused every verb on a property they were not granted', async () => {
    const attempts = [
      request(app)
        .get(`/api/v1/properties/${fx.ungranted}`)
        .set(...authHeader(fx.managerToken)),
      request(app)
        .patch(`/api/v1/properties/${fx.ungranted}`)
        .set(...authHeader(fx.managerToken))
        .send({ name: 'Renamed' }),
      request(app)
        .get(`/api/v1/properties/${fx.ungranted}/rooms`)
        .set(...authHeader(fx.managerToken)),
      request(app)
        .post(`/api/v1/properties/${fx.ungranted}/rooms`)
        .set(...authHeader(fx.managerToken))
        .send({ name: '888', roomType: 'Ghost' }),
      request(app)
        .get(`/api/v1/properties/${fx.ungranted}/rooms/${fx.ungrantedRoom}`)
        .set(...authHeader(fx.managerToken)),
      request(app)
        .patch(`/api/v1/properties/${fx.ungranted}/rooms/${fx.ungrantedRoom}`)
        .set(...authHeader(fx.managerToken))
        .send({ status: 'MAINTENANCE' }),
      request(app)
        .delete(`/api/v1/properties/${fx.ungranted}/rooms/${fx.ungrantedRoom}`)
        .set(...authHeader(fx.managerToken)),
    ];

    for (const res of await Promise.all(attempts)) {
      // 403, not 404: the property exists in their own organization, so
      // "you aren't granted onto it" is the accurate and safe answer.
      expect(res.status).toBe(403);
    }
  });

  it('a property-scoped listing shows only granted properties, and counts only those', async () => {
    const res = await request(app)
      .get('/api/v1/properties?pageSize=100')
      .set(...authHeader(fx.managerToken));

    expect(res.status).toBe(200);
    expect(res.body.properties.map((p: { id: string }) => p.id)).toEqual([fx.granted]);
    // The total must reflect the grant, not the organization — otherwise
    // it discloses how many properties exist that they cannot see.
    expect(res.body.page.totalItems).toBe(1);
  });
});

describe('G. IDOR — a manipulated ID cannot cross a boundary', () => {
  it('a room cannot be reached through a different parent property', async () => {
    // The granted property is a legitimate URL prefix for this caller;
    // the room ID belongs to a property they were never granted. The
    // pairing must not resolve for anyone, including org-wide roles.
    for (const token of [fx.ownerToken, fx.adminToken, fx.managerToken, fx.staffToken]) {
      const res = await request(app)
        .get(`/api/v1/properties/${fx.granted}/rooms/${fx.ungrantedRoom}`)
        .set(...authHeader(token));
      expect(res.status).toBe(404);
    }
  });

  it('a room cannot be mutated or deleted through a different parent property', async () => {
    const patched = await request(app)
      .patch(`/api/v1/properties/${fx.granted}/rooms/${fx.ungrantedRoom}`)
      .set(...authHeader(fx.ownerToken))
      .send({ status: 'MAINTENANCE' });
    expect(patched.status).toBe(404);

    const deleted = await request(app)
      .delete(`/api/v1/properties/${fx.granted}/rooms/${fx.ungrantedRoom}`)
      .set(...authHeader(fx.ownerToken));
    expect(deleted.status).toBe(404);

    // And the room is untouched.
    const intact = await request(app)
      .get(`/api/v1/properties/${fx.ungranted}/rooms/${fx.ungrantedRoom}`)
      .set(...authHeader(fx.ownerToken));
    expect(intact.status).toBe(200);
    expect(intact.body.room.status).toBe('ACTIVE');
  });
});

describe('H. missing or malformed resources — controlled errors', () => {
  it('returns 404, never a 500, for absent or non-UUID identifiers', async () => {
    const paths = [
      `/api/v1/properties/${randomUUID()}`,
      '/api/v1/properties/not-a-uuid',
      `/api/v1/properties/${randomUUID()}/rooms`,
      `/api/v1/properties/${fx.granted}/rooms/${randomUUID()}`,
      `/api/v1/staff/${randomUUID()}`,
    ];

    for (const path of paths) {
      const res = await request(app)
        .get(path)
        .set(...authHeader(fx.ownerToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
  });
});

describe('body-supplied property IDs are bounded by the granter’s own access', () => {
  it('an org-wide caller can grant any property in the organization', async () => {
    // The behaviour that must not regress: OWNER/ADMIN are org-wide, so
    // the access check is a no-op for them.
    const res = await request(app)
      .put(`/api/v1/staff/${fx.targetStaffId}/property-access`)
      .set(...authHeader(fx.ownerToken))
      .send({ propertyIds: [fx.granted, fx.ungranted] });

    expect(res.status).toBe(200);
    expect(res.body.staff.propertyIds.sort()).toEqual([fx.granted, fx.ungranted].sort());

    // Restore the fixture's grant so later assertions stay meaningful.
    await request(app)
      .put(`/api/v1/staff/${fx.targetStaffId}/property-access`)
      .set(...authHeader(fx.ownerToken))
      .send({ propertyIds: [] });
  });

  it('a property-scoped caller holding staff:manage cannot grant a property they lack', async () => {
    /**
     * No role currently combines `staff:manage` with property-scoped
     * access, so this state is not reachable over HTTP — which is exactly
     * why it needs a test. `staff:manage` is a flat permission, so the
     * day such a role exists, this is the check standing between it and
     * granting itself access to every property in the organization.
     *
     * The service is invoked inside a real request context rather than
     * mocked: the guard, `canAccessProperty` and the tenant-scoped client
     * all run for real. Only the caller's claims are synthesised.
     */
    const context = {
      userId: fx.managerId,
      organizationId: fx.organizationId,
      permissions: new Set(['staff:read', 'staff:manage'] as never),
      roleNames: new Set(['MANAGER'] as never), // deliberately NOT org-wide
      grantedPropertyIds: new Set([fx.granted]),
    };

    await expect(
      runWithRequestContext(context, () => setPropertyAccess(fx.targetStaffId, [fx.ungranted])),
    ).rejects.toThrow(/grant access to a property you don't have access to/i);

    // The same caller granting a property they *do* hold is still fine,
    // so the check narrows rather than blocking the operation outright.
    await expect(
      runWithRequestContext(context, () => setPropertyAccess(fx.targetStaffId, [fx.granted])),
    ).resolves.toBeDefined();
  });

  it('a property from another organization is still a 404, not a 403', async () => {
    // Existence must not be disclosed across a tenant boundary, so the
    // organization check has to run before the access check.
    const other = await loginAsNewOwner('Authz Foreign Org');
    const foreign = await createProperty(other.token, 'Foreign');

    const res = await request(app)
      .put(`/api/v1/staff/${fx.targetStaffId}/property-access`)
      .set(...authHeader(fx.ownerToken))
      .send({ propertyIds: [foreign] });

    expect(res.status).toBe(404);
  });
});

describe('I. authentication behaviour is unchanged', () => {
  it('every sensitive route rejects an unauthenticated request with 401', async () => {
    const paths: [string, string][] = [
      ['get', '/api/v1/properties'],
      ['get', `/api/v1/properties/${fx.granted}`],
      ['get', `/api/v1/properties/${fx.granted}/rooms`],
      ['get', '/api/v1/staff'],
      ['get', '/api/v1/audit-logs'],
      ['get', '/api/v1/organizations/me'],
    ];

    for (const [method, path] of paths) {
      const res = await (method === 'get' ? request(app).get(path) : request(app).post(path));
      expect(res.status).toBe(401);
    }
  });

  it('every rejection reason returns the identical message, disclosing nothing', async () => {
    // The security property is sameness, not wording: a distinct message
    // per cause would let a caller tell "malformed token" from "your
    // account was revoked".
    const malformed = await request(app).get('/api/v1/properties').set('Authorization', 'Bearer not.a.token');
    const wrongSecret = await request(app)
      .get('/api/v1/properties')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.wrongsignature');

    expect(malformed.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(malformed.body.error.message).toBe(wrongSecret.body.error.message);
    expect(malformed.body.error.code).toBe('unauthorized');
  });
});

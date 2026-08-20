/**
 * Staff-management API. The security-relevant half of this suite is the
 * privilege-escalation block: `staff:manage` is a flat permission, so the
 * only thing stopping an ADMIN from minting an OWNER, demoting a peer, or
 * locking out the account above theirs is the role-rank rule in
 * `modules/staff/service.ts`. Those cases exist to fail loudly if that
 * rule is ever relaxed.
 *
 * Cross-organization cases for these routes live in
 * `tenant-isolation.test.ts`, per that file's standing contract.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAs, loginAsNewOwner } from './helpers.js';

interface StaffPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';
  propertyIds?: string[];
}

function staffPayload(role: StaffPayload['role'], overrides: Partial<StaffPayload> = {}): StaffPayload {
  const suffix = randomUUID().slice(0, 8);
  return {
    email: `${role.toLowerCase()}-${suffix}@example.com`,
    password: 'correct-horse-battery-staple',
    firstName: 'Sam',
    lastName: 'Staffer',
    role,
    ...overrides,
  };
}

async function createStaff(token: string, payload: StaffPayload) {
  return request(app)
    .post('/api/v1/staff')
    .set(...authHeader(token))
    .send(payload);
}

async function createProperty(token: string, slug = `house-${randomUUID().slice(0, 8)}`) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: 'Main House', slug });
  return res.body.property.id as string;
}

describe('staff creation', () => {
  it('an OWNER can create a staff member who can then actually log in and use the API', async () => {
    const owner = await loginAsNewOwner('Staff Create Org');
    const payload = staffPayload('STAFF');

    const created = await createStaff(owner.token, payload);
    expect(created.status).toBe(201);
    expect(created.body.staff.email).toBe(payload.email);
    expect(created.body.staff.role).toBe('STAFF');
    expect(created.body.staff.roleNames).toEqual(['STAFF']);
    expect(created.body.staff.isActive).toBe(true);

    // The point of the endpoint: the created account is a real, usable
    // login, not just a row. Before this module existed there was no way
    // for an organization to have a second user at all.
    const staffToken = await loginAs(payload.email, payload.password);
    const properties = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(staffToken));
    expect(properties.status).toBe(200);
  });

  it('never returns the password hash or the revocation watermark', async () => {
    const owner = await loginAsNewOwner('Staff Leak Org');
    const created = await createStaff(owner.token, staffPayload('MANAGER'));

    expect(created.status).toBe(201);
    expect(created.body.staff).not.toHaveProperty('passwordHash');
    expect(created.body.staff).not.toHaveProperty('tokensValidAfter');
    expect(JSON.stringify(created.body)).not.toContain('$argon2');

    const list = await request(app)
      .get('/api/v1/staff')
      .set(...authHeader(owner.token));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    expect(JSON.stringify(list.body)).not.toContain('$argon2');
  });

  it('stores a real argon2 hash rather than the plaintext password', async () => {
    const owner = await loginAsNewOwner('Staff Hash Org');
    const payload = staffPayload('STAFF');
    await createStaff(owner.token, payload);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    expect(row.passwordHash).toBeTruthy();
    expect(row.passwordHash).not.toBe(payload.password);
    expect(row.passwordHash?.startsWith('$argon2')).toBe(true);
  });

  it('rejects a duplicate email with 409', async () => {
    const owner = await loginAsNewOwner('Staff Dup Org');
    const payload = staffPayload('STAFF');

    expect((await createStaff(owner.token, payload)).status).toBe(201);
    const second = await createStaff(owner.token, payload);
    expect(second.status).toBe(409);
  });

  it('rejects a password shorter than the signup minimum', async () => {
    const owner = await loginAsNewOwner('Staff Weak Org');
    const res = await createStaff(owner.token, staffPayload('STAFF', { password: 'short' }));
    expect(res.status).toBe(400);
  });

  it('grants property access at creation time', async () => {
    const owner = await loginAsNewOwner('Staff Grant Org');
    const propertyId = await createProperty(owner.token);

    const created = await createStaff(owner.token, staffPayload('MANAGER', { propertyIds: [propertyId] }));
    expect(created.status).toBe(201);
    expect(created.body.staff.propertyIds).toEqual([propertyId]);
  });
});

describe('privilege escalation is blocked', () => {
  /** Creates an ADMIN in the owner's org and returns their access token. */
  async function createAdminToken(ownerToken: string) {
    const payload = staffPayload('ADMIN');
    const created = await createStaff(ownerToken, payload);
    if (created.status !== 201) {
      throw new Error(`admin creation failed: ${created.status} ${JSON.stringify(created.body)}`);
    }
    return { token: await loginAs(payload.email, payload.password), id: created.body.staff.id as string };
  }

  it('an ADMIN cannot create an OWNER', async () => {
    const owner = await loginAsNewOwner('Escalation Org 1');
    const admin = await createAdminToken(owner.token);

    const attempt = await createStaff(admin.token, staffPayload('OWNER'));
    expect(attempt.status).toBe(403);
  });

  it('an ADMIN cannot promote a STAFF member to OWNER', async () => {
    const owner = await loginAsNewOwner('Escalation Org 2');
    const admin = await createAdminToken(owner.token);
    const staff = await createStaff(owner.token, staffPayload('STAFF'));

    const attempt = await request(app)
      .patch(`/api/v1/staff/${staff.body.staff.id}`)
      .set(...authHeader(admin.token))
      .send({ role: 'OWNER' });
    expect(attempt.status).toBe(403);

    // And the role really didn't move.
    const after = await request(app)
      .get(`/api/v1/staff/${staff.body.staff.id}`)
      .set(...authHeader(owner.token));
    expect(after.body.staff.roleNames).toEqual(['STAFF']);
  });

  it('an ADMIN cannot modify the OWNER above them', async () => {
    const owner = await loginAsNewOwner('Escalation Org 3');
    const admin = await createAdminToken(owner.token);
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { email: owner.ownerEmail } });

    const demote = await request(app)
      .patch(`/api/v1/staff/${ownerRow.id}`)
      .set(...authHeader(admin.token))
      .send({ role: 'STAFF' });
    expect(demote.status).toBe(403);

    const deactivate = await request(app)
      .patch(`/api/v1/staff/${ownerRow.id}`)
      .set(...authHeader(admin.token))
      .send({ isActive: false });
    expect(deactivate.status).toBe(403);

    const stillOwner = await prisma.user.findUniqueOrThrow({ where: { id: ownerRow.id } });
    expect(stillOwner.role).toBe('OWNER');
    expect(stillOwner.isActive).toBe(true);
  });

  it('an ADMIN cannot modify a peer ADMIN', async () => {
    const owner = await loginAsNewOwner('Escalation Org 4');
    const adminA = await createAdminToken(owner.token);
    const adminB = await createStaff(owner.token, staffPayload('ADMIN'));

    const attempt = await request(app)
      .patch(`/api/v1/staff/${adminB.body.staff.id}`)
      .set(...authHeader(adminA.token))
      .send({ isActive: false });
    expect(attempt.status).toBe(403);
  });

  it('a user cannot change their own role or deactivate themselves', async () => {
    const owner = await loginAsNewOwner('Self Guard Org');
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { email: owner.ownerEmail } });

    const selfDemote = await request(app)
      .patch(`/api/v1/staff/${ownerRow.id}`)
      .set(...authHeader(owner.token))
      .send({ role: 'STAFF' });
    expect(selfDemote.status).toBe(403);

    const selfDeactivate = await request(app)
      .patch(`/api/v1/staff/${ownerRow.id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });
    expect(selfDeactivate.status).toBe(403);

    // The consequence that matters: the last OWNER can never be removed,
    // so an organization can't be locked out of its own account.
    const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: ownerRow.id } });
    expect(stillActive.isActive).toBe(true);
    expect(stillActive.role).toBe('OWNER');
  });
});

describe('permission gating', () => {
  it('a STAFF member cannot read or create staff', async () => {
    const owner = await loginAsNewOwner('Gating Org');
    const payload = staffPayload('STAFF');
    await createStaff(owner.token, payload);
    const staffToken = await loginAs(payload.email, payload.password);

    const list = await request(app)
      .get('/api/v1/staff')
      .set(...authHeader(staffToken));
    expect(list.status).toBe(403);

    const create = await createStaff(staffToken, staffPayload('STAFF'));
    expect(create.status).toBe(403);
  });

  it('a MANAGER can read staff but not create them', async () => {
    const owner = await loginAsNewOwner('Manager Read Org');
    const payload = staffPayload('MANAGER');
    await createStaff(owner.token, payload);
    const managerToken = await loginAs(payload.email, payload.password);

    const list = await request(app)
      .get('/api/v1/staff')
      .set(...authHeader(managerToken));
    expect(list.status).toBe(200);

    const create = await createStaff(managerToken, staffPayload('STAFF'));
    expect(create.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/staff');
    expect(res.status).toBe(401);
  });
});

describe('role changes and deactivation take effect immediately', () => {
  it('a demotion invalidates the already-issued access token, and the new token has fewer permissions', async () => {
    const owner = await loginAsNewOwner('Demotion Org');
    const payload = staffPayload('MANAGER');
    const created = await createStaff(owner.token, payload);

    const beforeToken = await loginAs(payload.email, payload.password);
    // A MANAGER holds properties:update, so this succeeds first.
    const propertyId = await createProperty(owner.token);
    await request(app)
      .put(`/api/v1/staff/${created.body.staff.id}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [propertyId] });

    // Re-login so the token carries the grant just made.
    const grantedToken = await loginAs(payload.email, payload.password);
    const allowedBefore = await request(app)
      .patch(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(grantedToken))
      .send({ name: 'Renamed By Manager' });
    expect(allowedBefore.status).toBe(200);

    // Demote to STAFF, which does not hold properties:update.
    const demote = await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ role: 'STAFF' });
    expect(demote.status).toBe(200);
    expect(demote.body.staff.roleNames).toEqual(['STAFF']);

    // The token they were already holding is now rejected outright —
    // it carries the old permission list, so it must not keep working.
    const afterDemotion = await request(app)
      .patch(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(grantedToken))
      .send({ name: 'Should Not Apply' });
    expect(afterDemotion.status).toBe(401);

    // A fresh login reflects the demotion rather than restoring the old power.
    const staffToken = await loginAs(payload.email, payload.password);
    const afterRelogin = await request(app)
      .patch(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(staffToken))
      .send({ name: 'Still Should Not Apply' });
    expect(afterRelogin.status).toBe(403);

    // And the property kept the last legitimate name.
    const property = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(owner.token));
    expect(property.body.property.name).toBe('Renamed By Manager');

    // `beforeToken` was issued before any of this and is equally dead.
    const staleToken = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(beforeToken));
    expect(staleToken.status).toBe(401);
  });

  it('deactivation kills the access token and the refresh session together', async () => {
    const owner = await loginAsNewOwner('Deactivation Org');
    const payload = staffPayload('MANAGER');
    const created = await createStaff(owner.token, payload);

    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: payload.email, password: payload.password });
    expect(login.status).toBe(200);
    const staffToken = login.body.accessToken as string;

    const beforeDeactivation = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(staffToken));
    expect(beforeDeactivation.status).toBe(200);

    const deactivate = await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.staff.isActive).toBe(false);

    // Access token: rejected immediately via the revocation watermark,
    // without waiting out its own 15-minute expiry.
    const afterDeactivation = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(staffToken));
    expect(afterDeactivation.status).toBe(401);

    // Refresh session: revoked too, so they can't mint a fresh token.
    const refreshed = await agent.post('/api/v1/auth/refresh').send();
    expect(refreshed.status).toBe(401);

    // And logging in again is refused outright.
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: payload.password });
    expect(relogin.status).toBe(401);
  });

  it('a deactivated staff member can be reactivated and log in again', async () => {
    const owner = await loginAsNewOwner('Reactivation Org');
    const payload = staffPayload('STAFF');
    const created = await createStaff(owner.token, payload);

    await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });
    expect(
      (await request(app).post('/api/v1/auth/login').send({ email: payload.email, password: payload.password })).status,
    ).toBe(401);

    const reactivate = await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: true });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.staff.isActive).toBe(true);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: payload.password });
    expect(relogin.status).toBe(200);
  });

  it('a role change replaces the previous assignment rather than stacking on it', async () => {
    const owner = await loginAsNewOwner('Role Replace Org');
    const created = await createStaff(owner.token, staffPayload('STAFF'));

    const promoted = await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({ role: 'MANAGER' });

    expect(promoted.status).toBe(200);
    expect(promoted.body.staff.roleNames).toEqual(['MANAGER']);
    expect(promoted.body.staff.role).toBe('MANAGER');

    // The label on `User.role` and the actual grant must not drift apart.
    const assignments = await prisma.userRoleAssignment.count({ where: { userId: created.body.staff.id } });
    expect(assignments).toBe(1);
  });
});

describe('property access management', () => {
  it('granting access lets a MANAGER reach the property; revoking it takes the access away', async () => {
    const owner = await loginAsNewOwner('Access Mgmt Org');
    const propertyId = await createProperty(owner.token);
    const payload = staffPayload('MANAGER');
    const created = await createStaff(owner.token, payload);

    // No grant yet: 403 from the property-access guard.
    const ungrantedToken = await loginAs(payload.email, payload.password);
    const before = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(ungrantedToken));
    expect(before.status).toBe(403);

    const grant = await request(app)
      .put(`/api/v1/staff/${created.body.staff.id}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [propertyId] });
    expect(grant.status).toBe(200);
    expect(grant.body.staff.propertyIds).toEqual([propertyId]);

    const grantedToken = await loginAs(payload.email, payload.password);
    const after = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(grantedToken));
    expect(after.status).toBe(200);

    // Revoking invalidates the token that carried the grant.
    const revoke = await request(app)
      .put(`/api/v1/staff/${created.body.staff.id}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [] });
    expect(revoke.status).toBe(200);
    expect(revoke.body.staff.propertyIds).toEqual([]);

    const withStaleGrant = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(grantedToken));
    expect(withStaleGrant.status).toBe(401);

    const revokedToken = await loginAs(payload.email, payload.password);
    const afterRevoke = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...authHeader(revokedToken));
    expect(afterRevoke.status).toBe(403);
  });

  it('replaces the whole grant set rather than appending to it', async () => {
    const owner = await loginAsNewOwner('Access Replace Org');
    const first = await createProperty(owner.token);
    const second = await createProperty(owner.token);
    const created = await createStaff(owner.token, staffPayload('MANAGER', { propertyIds: [first] }));

    const replaced = await request(app)
      .put(`/api/v1/staff/${created.body.staff.id}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [second] });

    expect(replaced.status).toBe(200);
    expect(replaced.body.staff.propertyIds).toEqual([second]);
  });

  it('rejects a property ID that is not a real property', async () => {
    const owner = await loginAsNewOwner('Access Bogus Org');
    const created = await createStaff(owner.token, staffPayload('MANAGER'));

    const res = await request(app)
      .put(`/api/v1/staff/${created.body.staff.id}/property-access`)
      .set(...authHeader(owner.token))
      .send({ propertyIds: [randomUUID()] });

    expect(res.status).toBe(404);
  });
});

describe('validation and lookup', () => {
  it('404s for a staff member who does not exist', async () => {
    const owner = await loginAsNewOwner('Lookup Org');
    const res = await request(app)
      .get(`/api/v1/staff/${randomUUID()}`)
      .set(...authHeader(owner.token));
    expect(res.status).toBe(404);
  });

  it('rejects an empty update body', async () => {
    const owner = await loginAsNewOwner('Empty Update Org');
    const created = await createStaff(owner.token, staffPayload('STAFF'));

    const res = await request(app)
      .patch(`/api/v1/staff/${created.body.staff.id}`)
      .set(...authHeader(owner.token))
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects a role outside the built-in presets', async () => {
    const owner = await loginAsNewOwner('Bad Role Org');
    const res = await createStaff(owner.token, staffPayload('STAFF', { role: 'SUPERUSER' as StaffPayload['role'] }));
    expect(res.status).toBe(400);
  });

  it('lists the owner plus every staff member created in the organization', async () => {
    const owner = await loginAsNewOwner('Listing Org');
    await createStaff(owner.token, staffPayload('MANAGER'));
    await createStaff(owner.token, staffPayload('STAFF'));

    const list = await request(app)
      .get('/api/v1/staff')
      .set(...authHeader(owner.token));

    expect(list.status).toBe(200);
    expect(list.body.staff).toHaveLength(3);
    expect(list.body.staff.map((member: { role: string }) => member.role).sort()).toEqual([
      'MANAGER',
      'OWNER',
      'STAFF',
    ]);
  });
});

import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

describe('/api/v1/properties', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/properties');
    expect(res.status).toBe(401);
  });

  it('creates, lists, reads, updates, and deletes a property', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);

    const create = await request(app)
      .post('/api/v1/properties')
      .set(...auth)
      .send({ name: 'Main House', slug: 'main-house' });
    expect(create.status).toBe(201);
    const propertyId = create.body.property.id as string;
    expect(create.body.property.timezone).toBe('UTC');

    const list = await request(app)
      .get('/api/v1/properties')
      .set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.properties).toHaveLength(1);

    const get = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...auth);
    expect(get.status).toBe(200);
    expect(get.body.property.id).toBe(propertyId);

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyId}`)
      .set(...auth)
      .send({ name: 'Main House Renamed' });
    expect(update.status).toBe(200);
    expect(update.body.property.name).toBe('Main House Renamed');

    const del = await request(app)
      .delete(`/api/v1/properties/${propertyId}`)
      .set(...auth);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/v1/properties/${propertyId}`)
      .set(...auth);
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects a duplicate slug within the same organization with 409', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);

    await request(app)
      .post('/api/v1/properties')
      .set(...auth)
      .send({ name: 'First', slug: 'dup' });
    const second = await request(app)
      .post('/api/v1/properties')
      .set(...auth)
      .send({ name: 'Second', slug: 'dup' });

    expect(second.status).toBe(409);
  });

  it('rejects an invalid slug with a validation error', async () => {
    const { token } = await loginAsNewOwner();
    const res = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(token))
      .send({ name: 'Bad Slug', slug: 'Not A Valid Slug!' });

    expect(res.status).toBe(400);
  });
});

describe('properties listing: pagination, search and filters', () => {
  /** Five properties in one fresh organization, plus the owner's token. */
  async function seedProperties() {
    const owner = await loginAsNewOwner('Property Roster Org');
    const seeds = [
      { name: 'Seaside Villa', slug: 'seaside-villa', city: 'Goa' },
      { name: 'Seaside Cottage', slug: 'seaside-cottage', city: 'Goa' },
      { name: 'Mountain Lodge', slug: 'mountain-lodge', city: 'Manali' },
      { name: 'City Loft', slug: 'city-loft', city: 'Mumbai' },
      { name: 'Riverside Inn', slug: 'riverside-inn', city: 'Rishikesh' },
    ];
    const created = [];
    for (const seed of seeds) {
      const res = await request(app)
        .post('/api/v1/properties')
        .set(...authHeader(owner.token))
        .send(seed);
      if (res.status !== 201) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
      created.push(res.body.property);
    }
    return { owner, created };
  }

  function list(token: string, query = '') {
    return request(app)
      .get(`/api/v1/properties${query}`)
      .set(...authHeader(token));
  }

  it('returns the shared pagination envelope', async () => {
    const { owner } = await seedProperties();

    const res = await list(owner.token);

    expect(res.status).toBe(200);
    expect(res.body.page).toEqual({ page: 1, pageSize: 25, totalItems: 5, totalPages: 1 });
  });

  it('pages without dropping or duplicating a row', async () => {
    const { owner } = await seedProperties();

    const p1 = await list(owner.token, '?page=1&pageSize=2');
    const p2 = await list(owner.token, '?page=2&pageSize=2');
    const p3 = await list(owner.token, '?page=3&pageSize=2');

    expect(p1.body.properties).toHaveLength(2);
    expect(p3.body.properties).toHaveLength(1);
    expect(p1.body.page.totalPages).toBe(3);

    const ids = [...p1.body.properties, ...p2.body.properties, ...p3.body.properties].map(
      (p: { id: string }) => p.id,
    );
    expect(new Set(ids).size).toBe(5);
  });

  it('searches name, slug and city, requiring every term to match', async () => {
    const { owner } = await seedProperties();

    const byName = await list(owner.token, '?search=seaside');
    expect(byName.body.page.totalItems).toBe(2);

    const bySlug = await list(owner.token, '?search=mountain-lodge');
    expect(bySlug.body.page.totalItems).toBe(1);

    const byCity = await list(owner.token, '?search=goa');
    expect(byCity.body.page.totalItems).toBe(2);

    // Both terms must match: "seaside villa" excludes the cottage.
    const multiTerm = await list(owner.token, '?search=seaside%20villa');
    expect(multiTerm.body.page.totalItems).toBe(1);
    expect(multiTerm.body.properties[0].name).toBe('Seaside Villa');
  });

  it('filters by active status', async () => {
    const { owner, created } = await seedProperties();
    await request(app)
      .patch(`/api/v1/properties/${created[0].id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });

    const inactive = await list(owner.token, '?status=INACTIVE');
    expect(inactive.body.page.totalItems).toBe(1);
    expect(inactive.body.properties[0].id).toBe(created[0].id);

    const active = await list(owner.token, '?status=ACTIVE');
    expect(active.body.page.totalItems).toBe(4);
  });

  it('reports a filtered total, not the unfiltered one', async () => {
    const { owner } = await seedProperties();

    const res = await list(owner.token, '?search=goa&pageSize=1');

    expect(res.body.properties).toHaveLength(1);
    expect(res.body.page.totalItems).toBe(2);
    expect(res.body.page.totalPages).toBe(2);
  });

  it('rejects invalid pagination and filter values', async () => {
    const { owner } = await seedProperties();

    expect((await list(owner.token, '?pageSize=101')).status).toBe(400);
    expect((await list(owner.token, '?page=0')).status).toBe(400);
    expect((await list(owner.token, '?status=PERHAPS')).status).toBe(400);
  });
});

describe('properties listing: PropertyAccess is applied in the query', () => {
  /**
   * The regression this guards: the grant filter used to run over the
   * fetched rows. Once the endpoint paginated, filtering after the slice
   * would return short pages and a total counting properties the caller
   * cannot see — so these assertions are about `page.totalItems` as much
   * as about the rows.
   */
  async function managerWithOneGrant() {
    const owner = await loginAsNewOwner('Grant Paging Org');
    const ids: string[] = [];
    for (const slug of ['alpha', 'bravo', 'charlie', 'delta']) {
      const res = await request(app)
        .post('/api/v1/properties')
        .set(...authHeader(owner.token))
        .send({ name: slug.toUpperCase(), slug });
      ids.push(res.body.property.id);
    }

    const staff = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(owner.token))
      .send({
        email: `grant-${randomUUID().slice(0, 8)}@example.com`,
        password: 'correct-horse-battery-staple',
        firstName: 'Mary',
        lastName: 'Manager',
        role: 'MANAGER',
        propertyIds: [ids[0]],
      });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: staff.body.staff.email, password: 'correct-horse-battery-staple' });

    return { owner, ids, managerToken: login.body.accessToken as string };
  }

  it('counts only the properties the caller is granted', async () => {
    const { ids, managerToken } = await managerWithOneGrant();

    const res = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(managerToken));

    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].id).toBe(ids[0]);
    // The total must reflect the grant, not the organization.
    expect(res.body.page.totalItems).toBe(1);
    expect(res.body.page.totalPages).toBe(1);
  });

  it('does not return a short page for a granted subset', async () => {
    const { managerToken } = await managerWithOneGrant();

    const res = await request(app)
      .get('/api/v1/properties?pageSize=2')
      .set(...authHeader(managerToken));

    // One granted property, so one row on a page sized for two — and a
    // total of 1, not 4.
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.page.totalItems).toBe(1);
  });

  it('an OWNER still sees every property in the organization', async () => {
    const { owner } = await managerWithOneGrant();

    const res = await request(app)
      .get('/api/v1/properties')
      .set(...authHeader(owner.token));

    expect(res.body.page.totalItems).toBe(4);
  });
});

describe('property mutations are audited', () => {
  async function auditFor(organizationId: string, action?: string) {
    return prisma.auditLog.findMany({
      where: { organizationId, ...(action ? { action } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  it('records a creation with the name and slug', async () => {
    const owner = await loginAsNewOwner('Property Audit Create');
    const res = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Audited House', slug: 'audited-house' });

    const rows = await auditFor(owner.organizationId, 'property.created');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('property');
    expect(rows[0]!.entityId).toBe(res.body.property.id);
    expect(rows[0]!.actorEmail).toBe(owner.ownerEmail);
    expect(rows[0]!.metadata).toEqual({ name: 'Audited House', slug: 'audited-house' });
  });

  it('records an update with only the fields that actually changed', async () => {
    const owner = await loginAsNewOwner('Property Audit Update');
    const created = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Before', slug: 'before-slug', city: 'Pune' });

    await request(app)
      .patch(`/api/v1/properties/${created.body.property.id}`)
      .set(...authHeader(owner.token))
      .send({ name: 'After', city: 'Pune' }); // city resubmitted unchanged

    const rows = await auditFor(owner.organizationId, 'property.updated');
    expect(rows).toHaveLength(1);
    const metadata = rows[0]!.metadata as { name: string; changed: Record<string, unknown> };
    expect(metadata.changed).toEqual({ name: { from: 'Before', to: 'After' } });
    // The unchanged resubmitted field is absent.
    expect(metadata.changed).not.toHaveProperty('city');
  });

  it('records a deactivation as an isActive change', async () => {
    const owner = await loginAsNewOwner('Property Audit Deactivate');
    const created = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Toggle', slug: 'toggle-slug' });

    await request(app)
      .patch(`/api/v1/properties/${created.body.property.id}`)
      .set(...authHeader(owner.token))
      .send({ isActive: false });

    const rows = await auditFor(owner.organizationId, 'property.updated');
    const metadata = rows[0]!.metadata as { changed: Record<string, unknown> };
    expect(metadata.changed).toEqual({ isActive: { from: true, to: false } });
  });

  it('writes no update entry when nothing moved', async () => {
    const owner = await loginAsNewOwner('Property Audit Noop');
    const created = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Same', slug: 'same-slug' });

    await request(app)
      .patch(`/api/v1/properties/${created.body.property.id}`)
      .set(...authHeader(owner.token))
      .send({ name: 'Same' });

    expect(await auditFor(owner.organizationId, 'property.updated')).toHaveLength(0);
  });

  it('records a deletion, including how many rooms cascaded', async () => {
    const owner = await loginAsNewOwner('Property Audit Delete');
    const created = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Doomed', slug: 'doomed-slug' });
    const id = created.body.property.id as string;

    for (const name of ['101', '102']) {
      await request(app)
        .post(`/api/v1/properties/${id}/rooms`)
        .set(...authHeader(owner.token))
        .send({ name, roomType: 'Standard' });
    }

    await request(app)
      .delete(`/api/v1/properties/${id}`)
      .set(...authHeader(owner.token));

    const rows = await auditFor(owner.organizationId, 'property.deleted');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(id);
    expect(rows[0]!.metadata).toEqual({ name: 'Doomed', slug: 'doomed-slug', cascadedRooms: 2 });
  });

  it('writes nothing when a mutation is refused', async () => {
    const owner = await loginAsNewOwner('Property Audit Refused');
    const before = (await auditFor(owner.organizationId)).length;

    const missing = await request(app)
      .patch(`/api/v1/properties/${randomUUID()}`)
      .set(...authHeader(owner.token))
      .send({ name: 'Nope' });
    expect(missing.status).toBe(404);

    const invalid = await request(app)
      .post('/api/v1/properties')
      .set(...authHeader(owner.token))
      .send({ name: 'Bad', slug: 'Not Valid!' });
    expect(invalid.status).toBe(400);

    expect(await auditFor(owner.organizationId)).toHaveLength(before);
  });
});

/**
 * Marketing Studio media library, end to end against the real database with
 * the in-memory stub storage provider: presigned upload → verified complete →
 * list/filter/albums → edit → download → delete, plus upload verification,
 * validation, permission gating and tenant isolation.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { stubHasObject, stubPutObject } from '../src/platform/storage/stub-provider.js';
import { app, authHeader, loginAs, loginAsNewOwner } from './helpers.js';

async function makeProperty(token: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}`, city: 'Goa', country: 'India' });
  expect(res.status).toBe(201);
  return res.body.property.id as string;
}

const base = (propertyId: string) => `/api/v1/properties/${propertyId}/marketing/media`;

async function requestUpload(token: string, propertyId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${base(propertyId)}/uploads`)
    .set(...authHeader(token))
    .send({ fileName: 'diwali-lobby.jpg', contentType: 'image/jpeg', sizeBytes: 2048, ...body });
}

/** Full happy-path upload: request URL, "PUT" to stub storage, complete. */
async function uploadImage(token: string, propertyId: string, body: Record<string, unknown> = {}) {
  const up = await requestUpload(token, propertyId, body);
  expect(up.status).toBe(201);
  const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.body.asset.id } });
  stubPutObject(row.storageKey, { sizeBytes: row.sizeBytes, contentType: row.contentType });
  const done = await request(app)
    .post(`${base(propertyId)}/${up.body.asset.id}/complete`)
    .set(...authHeader(token));
  expect(done.status).toBe(200);
  return done.body.media;
}

describe('media upload lifecycle', () => {
  it('issues a presigned URL, verifies the stored object, then lists it READY', async () => {
    const { token, organizationId } = await loginAsNewOwner('Media Hotel');
    const propertyId = await makeProperty(token);

    const up = await requestUpload(token, propertyId, { album: 'Diwali 2026', tags: ['Festive', 'Lobby'] });
    expect(up.status).toBe(201);
    expect(up.body.uploadUrl).toMatch(/^stub:\/\/upload\//);
    expect(up.body.uploadHeaders).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(up.body.asset.status).toBe('PENDING');
    expect(up.body.asset.kind).toBe('IMAGE');
    expect(up.body.asset.url).toBeNull();
    expect(up.body.asset).not.toHaveProperty('storageKey');

    // The server namespaces the object key by org + property.
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.body.asset.id } });
    expect(row.storageKey.startsWith(`orgs/${organizationId}/properties/${propertyId}/media/`)).toBe(true);

    // PENDING items are not in the library.
    const before = await request(app).get(base(propertyId)).set(...authHeader(token));
    expect(before.body.media).toHaveLength(0);

    // Completing before the object exists is refused.
    const early = await request(app)
      .post(`${base(propertyId)}/${up.body.asset.id}/complete`)
      .set(...authHeader(token));
    expect(early.status).toBe(400);

    stubPutObject(row.storageKey, { sizeBytes: 2048, contentType: 'image/jpeg' });
    const done = await request(app)
      .post(`${base(propertyId)}/${up.body.asset.id}/complete`)
      .set(...authHeader(token));
    expect(done.status).toBe(200);
    expect(done.body.media.status).toBe('READY');
    expect(done.body.media.url).toMatch(/^stub:\/\/download\//);
    expect(done.body.media.tags).toEqual(['festive', 'lobby']);

    const list = await request(app).get(base(propertyId)).set(...authHeader(token));
    expect(list.body.media).toHaveLength(1);
    expect(list.body.page.totalItems).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'media_asset.uploaded', entityId: up.body.asset.id },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects and discards an upload whose stored object does not match the declaration', async () => {
    const { token } = await loginAsNewOwner('Media Hotel');
    const propertyId = await makeProperty(token);
    const up = await requestUpload(token, propertyId, { sizeBytes: 1000 });
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.body.asset.id } });
    stubPutObject(row.storageKey, { sizeBytes: 999_999, contentType: 'image/jpeg' });

    const done = await request(app)
      .post(`${base(propertyId)}/${up.body.asset.id}/complete`)
      .set(...authHeader(token));
    expect(done.status).toBe(400);
    expect(await prisma.mediaAsset.findUnique({ where: { id: row.id } })).toBeNull();
    expect(stubHasObject(row.storageKey)).toBe(false);
  });

  it('validates type and size limits', async () => {
    const { token } = await loginAsNewOwner('Media Hotel');
    const propertyId = await makeProperty(token);
    const svg = await requestUpload(token, propertyId, { fileName: 'x.svg', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(400);
    const huge = await requestUpload(token, propertyId, { sizeBytes: 26 * 1024 * 1024 });
    expect(huge.status).toBe(400);
    const video = await requestUpload(token, propertyId, {
      fileName: 'walkthrough.mp4',
      contentType: 'video/mp4',
      sizeBytes: 200 * 1024 * 1024,
    });
    expect(video.status).toBe(201);
    expect(video.body.asset.kind).toBe('VIDEO');
  });
});

describe('library browsing and editing', () => {
  it('filters by album/kind/search, groups albums, edits, downloads and deletes', async () => {
    const { token } = await loginAsNewOwner('Media Hotel');
    const propertyId = await makeProperty(token);
    const a = await uploadImage(token, propertyId, { album: 'Diwali 2026', title: 'Lobby lights' });
    await uploadImage(token, propertyId, { album: 'Diwali 2026', fileName: 'rangoli.png', contentType: 'image/png' });
    await uploadImage(token, propertyId, { album: 'Sharma Wedding', title: 'Mandap' });

    const albums = await request(app).get(`${base(propertyId)}/albums`).set(...authHeader(token));
    expect(albums.body.albums).toEqual([
      { album: 'Diwali 2026', count: 2 },
      { album: 'Sharma Wedding', count: 1 },
    ]);

    const diwali = await request(app)
      .get(base(propertyId))
      .query({ album: 'Diwali 2026' })
      .set(...authHeader(token));
    expect(diwali.body.media).toHaveLength(2);

    const search = await request(app)
      .get(base(propertyId))
      .query({ search: 'mandap' })
      .set(...authHeader(token));
    expect(search.body.media).toHaveLength(1);

    const videos = await request(app)
      .get(base(propertyId))
      .query({ kind: 'VIDEO' })
      .set(...authHeader(token));
    expect(videos.body.media).toHaveLength(0);

    const edit = await request(app)
      .patch(`${base(propertyId)}/${a.id}`)
      .set(...authHeader(token))
      .send({ title: 'Lobby at night', album: 'Sharma Wedding', tags: ['Night'] });
    expect(edit.status).toBe(200);
    expect(edit.body.media).toMatchObject({ title: 'Lobby at night', album: 'Sharma Wedding', tags: ['night'] });

    const dl = await request(app).get(`${base(propertyId)}/${a.id}/download`).set(...authHeader(token));
    expect(dl.status).toBe(200);
    expect(dl.body.url).toMatch(/^stub:\/\/download\//);

    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: a.id } });
    const del = await request(app).delete(`${base(propertyId)}/${a.id}`).set(...authHeader(token));
    expect(del.status).toBe(204);
    expect(stubHasObject(row.storageKey)).toBe(false);
    const gone = await request(app).get(`${base(propertyId)}/${a.id}`).set(...authHeader(token));
    expect(gone.status).toBe(404);
  });
});

describe('authorization and tenancy', () => {
  it('forbids STAFF (no marketing permissions)', async () => {
    const owner = await loginAsNewOwner('Media Hotel');
    const propertyId = await makeProperty(owner.token);
    const staffEmail = `staff-${randomUUID().slice(0, 8)}@example.com`;
    const created = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(owner.token))
      .send({
        email: staffEmail,
        password: 'correct-horse-battery-staple-1',
        firstName: 'Sam',
        lastName: 'Staffer',
        role: 'STAFF',
        propertyIds: [propertyId],
      });
    expect(created.status).toBe(201);
    const staffToken = await loginAs(staffEmail, 'correct-horse-battery-staple-1');

    expect((await request(app).get(base(propertyId)).set(...authHeader(staffToken))).status).toBe(403);
    expect((await requestUpload(staffToken, propertyId)).status).toBe(403);
  });

  it("never exposes or mutates another organization's media", async () => {
    const a = await loginAsNewOwner('Org A');
    const propA = await makeProperty(a.token);
    const asset = await uploadImage(a.token, propA, { title: 'Org A private' });

    const b = await loginAsNewOwner('Org B');
    const propB = await makeProperty(b.token);
    expect((await request(app).get(base(propA)).set(...authHeader(b.token))).status).toBe(404);
    // Addressing A's asset through B's own property resolves to nothing.
    expect((await request(app).get(`${base(propB)}/${asset.id}`).set(...authHeader(b.token))).status).toBe(404);
    expect((await request(app).delete(`${base(propB)}/${asset.id}`).set(...authHeader(b.token))).status).toBe(404);
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });
});

/**
 * AI Marketing Studio (2026-09-09), exercised end to end against the real
 * database with the deterministic stub content provider and the DB-backed
 * job worker: request → async generate → DRAFT → edit → approve, plus
 * discard, regenerate, the status guards, permission gating and tenant
 * isolation.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { drainJobs } from '../src/platform/jobs/worker.js';
import { app, authHeader, loginAs, loginAsNewOwner } from './helpers.js';

async function makeProperty(token: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: `Hotel ${suffix}`, slug: `hotel-${suffix}`, city: 'Jaipur', country: 'India' });
  expect(res.status).toBe(201);
  return res.body.property.id as string;
}

function base(propertyId: string): string {
  return `/api/v1/properties/${propertyId}/marketing/content`;
}

async function generate(
  token: string,
  propertyId: string,
  body: { format?: string; brief?: string; tone?: string } = {},
) {
  return request(app)
    .post(base(propertyId))
    .set(...authHeader(token))
    .send({ format: body.format ?? 'SOCIAL_POST', brief: body.brief ?? 'A monsoon weekend getaway offer.', ...(body.tone ? { tone: body.tone } : {}) });
}

describe('generate → draft lifecycle', () => {
  it('creates a GENERATING piece and the worker fills it to DRAFT', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);

    const res = await generate(token, propertyId, { tone: 'luxury' });
    expect(res.status).toBe(201);
    expect(res.body.content.status).toBe('GENERATING');
    expect(res.body.content.body).toBeNull();
    const id = res.body.content.id as string;

    // Worker runs the queued marketing.generate job.
    const handled = await drainJobs();
    expect(handled).toBeGreaterThanOrEqual(1);

    const after = await request(app)
      .get(`${base(propertyId)}/${id}`)
      .set(...authHeader(token));
    expect(after.body.content.status).toBe('DRAFT');
    expect(after.body.content.body).toBeTruthy();
    expect(after.body.content.provider).toBe('stub');
    // Stub grounds the copy in the property + brief.
    expect(after.body.content.body).toContain('monsoon weekend getaway');
    expect(after.body.content.title).toBeTruthy();
  });

  it('rejects a too-short brief with 400 and generates nothing', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const res = await request(app)
      .post(base(propertyId))
      .set(...authHeader(token))
      .send({ format: 'EMAIL', brief: 'x' });
    expect(res.status).toBe(400);

    const list = await request(app)
      .get(base(propertyId))
      .set(...authHeader(token));
    expect(list.body.content).toHaveLength(0);
  });
});

describe('edit / approve / discard', () => {
  async function draft(token: string, propertyId: string): Promise<string> {
    const res = await generate(token, propertyId);
    const id = res.body.content.id as string;
    await drainJobs();
    return id;
  }

  it('edits a draft — editedBody becomes the authoritative body', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const id = await draft(token, propertyId);

    const edited = await request(app)
      .patch(`${base(propertyId)}/${id}`)
      .set(...authHeader(token))
      .send({ editedBody: 'Our hand-tuned copy.' });
    expect(edited.status).toBe(200);
    expect(edited.body.content.status).toBe('DRAFT');
    expect(edited.body.content.editedBody).toBe('Our hand-tuned copy.');
    expect(edited.body.content.body).toBe('Our hand-tuned copy.');
    expect(edited.body.content.isEdited).toBe(true);
  });

  it('approves a draft, records the approver, and un-approves on a later edit', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const id = await draft(token, propertyId);

    const approved = await request(app)
      .post(`${base(propertyId)}/${id}/approve`)
      .set(...authHeader(token));
    expect(approved.status).toBe(200);
    expect(approved.body.content.status).toBe('APPROVED');
    expect(approved.body.content.approvedBy).not.toBeNull();
    expect(approved.body.content.approvedAt).not.toBeNull();

    // Editing an approved piece returns it to DRAFT — changed copy must be
    // re-approved.
    const edited = await request(app)
      .patch(`${base(propertyId)}/${id}`)
      .set(...authHeader(token))
      .send({ editedBody: 'Reworded after approval.' });
    expect(edited.body.content.status).toBe('DRAFT');
    expect(edited.body.content.approvedBy).toBeNull();
  });

  it('cannot approve a piece that is still generating', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const res = await generate(token, propertyId);
    const id = res.body.content.id as string;
    // Do NOT drain — it's still GENERATING.
    const approve = await request(app)
      .post(`${base(propertyId)}/${id}/approve`)
      .set(...authHeader(token));
    expect(approve.status).toBe(409);
  });

  it('discards a piece and blocks a second discard', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const id = await draft(token, propertyId);

    const first = await request(app)
      .post(`${base(propertyId)}/${id}/discard`)
      .set(...authHeader(token));
    expect(first.status).toBe(200);
    expect(first.body.content.status).toBe('DISCARDED');

    const second = await request(app)
      .post(`${base(propertyId)}/${id}/discard`)
      .set(...authHeader(token));
    expect(second.status).toBe(409);
  });

  it('regenerates a piece: clears edits, returns to GENERATING, redrafts', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const id = await draft(token, propertyId);

    await request(app)
      .patch(`${base(propertyId)}/${id}`)
      .set(...authHeader(token))
      .send({ editedBody: 'Manual copy that should be cleared.' });

    const regen = await request(app)
      .post(`${base(propertyId)}/${id}/regenerate`)
      .set(...authHeader(token));
    expect(regen.status).toBe(200);
    expect(regen.body.content.status).toBe('GENERATING');
    expect(regen.body.content.editedBody).toBeNull();
    expect(regen.body.content.generatedBody).toBeNull();

    await drainJobs();
    const after = await request(app)
      .get(`${base(propertyId)}/${id}`)
      .set(...authHeader(token));
    expect(after.body.content.status).toBe('DRAFT');
    expect(after.body.content.editedBody).toBeNull();
    expect(after.body.content.body).toBeTruthy();
  });
});

describe('list, filters, permissions & tenancy', () => {
  it('filters by status and format and searches the brief', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    await generate(token, propertyId, { format: 'TAGLINE', brief: 'A rooftop pool with a city view.' });
    await generate(token, propertyId, { format: 'EMAIL', brief: 'A festive dinner package.' });
    await drainJobs();

    const taglines = await request(app)
      .get(`${base(propertyId)}?format=TAGLINE`)
      .set(...authHeader(token));
    expect(taglines.body.content).toHaveLength(1);
    expect(taglines.body.content[0].format).toBe('TAGLINE');

    const drafts = await request(app)
      .get(`${base(propertyId)}?status=DRAFT`)
      .set(...authHeader(token));
    expect(drafts.body.content).toHaveLength(2);

    const search = await request(app)
      .get(`${base(propertyId)}?search=rooftop`)
      .set(...authHeader(token));
    expect(search.body.content).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(token);
    const res = await request(app).get(base(propertyId));
    expect(res.status).toBe(401);
  });

  it('forbids STAFF — marketing is management work, not front-desk', async () => {
    const owner = await loginAsNewOwner('Mktg Hotel');
    const propertyId = await makeProperty(owner.token);
    const suffix = randomUUID().slice(0, 8);
    const staffEmail = `staff-${suffix}@example.com`;
    const created = await request(app)
      .post('/api/v1/staff')
      .set(...authHeader(owner.token))
      .send({
        email: staffEmail,
        password: 'correct-horse-battery-staple',
        firstName: 'Sam',
        lastName: 'Staffer',
        role: 'STAFF',
        propertyIds: [propertyId],
      });
    expect(created.status).toBe(201);
    const staffToken = await loginAs(staffEmail, 'correct-horse-battery-staple');

    // STAFF has property access but not marketing:read → 403, not 404.
    const read = await request(app)
      .get(base(propertyId))
      .set(...authHeader(staffToken));
    expect(read.status).toBe(403);

    // And cannot generate either (marketing:manage).
    const gen = await generate(staffToken, propertyId);
    expect(gen.status).toBe(403);
  });

  it('never exposes another organization\'s content', async () => {
    const a = await loginAsNewOwner('Org A');
    const propA = await makeProperty(a.token);
    await generate(a.token, propA, { brief: 'Org A secret campaign.' });
    await drainJobs();

    // Org B cannot even see property A (cross-org property → 404).
    const b = await loginAsNewOwner('Org B');
    const cross = await request(app)
      .get(base(propA))
      .set(...authHeader(b.token));
    expect(cross.status).toBe(404);
  });
});

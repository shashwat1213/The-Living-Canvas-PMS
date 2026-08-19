import request from 'supertest';
import { describe, expect, it } from 'vitest';

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

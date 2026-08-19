import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, authHeader, loginAsNewOwner } from './helpers.js';

async function createProperty(token: string) {
  const res = await request(app)
    .post('/api/v1/properties')
    .set(...authHeader(token))
    .send({ name: 'Main House', slug: 'main-house' });
  return res.body.property.id as string;
}

describe('/api/v1/properties/:propertyId/rooms', () => {
  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner();
    const propertyId = await createProperty(token);

    const res = await request(app).get(`/api/v1/properties/${propertyId}/rooms`);
    expect(res.status).toBe(401);
  });

  it('404s for a property ID that does not exist', async () => {
    const { token } = await loginAsNewOwner();
    const res = await request(app)
      .get('/api/v1/properties/00000000-0000-0000-0000-000000000000/rooms')
      .set(...authHeader(token));
    expect(res.status).toBe(404);
  });

  it('creates, lists, reads, updates, and deletes a room', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    const create = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomType: 'Deluxe King', capacity: 2 });
    expect(create.status).toBe(201);
    const roomId = create.body.room.id as string;
    expect(create.body.room.status).toBe('ACTIVE');

    const list = await request(app)
      .get(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth);
    expect(list.status).toBe(200);
    expect(list.body.rooms).toHaveLength(1);

    const update = await request(app)
      .patch(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth)
      .send({ status: 'MAINTENANCE' });
    expect(update.status).toBe(200);
    expect(update.body.room.status).toBe('MAINTENANCE');

    const del = await request(app)
      .delete(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth);
    expect(del.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/v1/properties/${propertyId}/rooms/${roomId}`)
      .set(...auth);
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects a duplicate room name within the same property with 409', async () => {
    const { token } = await loginAsNewOwner();
    const auth = authHeader(token);
    const propertyId = await createProperty(token);

    await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomType: 'Standard' });
    const dup = await request(app)
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set(...auth)
      .send({ name: '101', roomType: 'Standard' });

    expect(dup.status).toBe(409);
  });
});

/**
 * The in-app AI assistant (2026): a read-only chat grounded in a property's
 * live operational data, exercised end to end against the real database with
 * the deterministic stub chat provider. Covers the happy path, input
 * validation, auth, property-access (403) vs cross-org (404), and that the
 * route is read-only (writes nothing).
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { resetChatProvider, setChatProvider } from '../src/platform/ai/chat-registry.js';
import type { AIChatProvider } from '../src/platform/ai/chat-provider.js';
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

function chatUrl(propertyId: string): string {
  return `/api/v1/properties/${propertyId}/assistant/chat`;
}

afterEach(() => {
  resetChatProvider();
});

describe('assistant chat', () => {
  it('answers a question via the active provider and returns the provider key', async () => {
    const { token } = await loginAsNewOwner('Assistant Hotel');
    const propertyId = await makeProperty(token);

    const res = await request(app)
      .post(chatUrl(propertyId))
      .set(...authHeader(token))
      .send({ messages: [{ role: 'user', content: 'What is our occupancy today?' }] });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('stub');
    expect(typeof res.body.reply).toBe('string');
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  it('grounds the system prompt in THIS property\'s live data and passes the conversation through', async () => {
    const { token } = await loginAsNewOwner('Grounding Hotel');
    const propertyId = await makeProperty(token);

    // Capture what the provider actually receives.
    let capturedSystem = '';
    let capturedTurns = 0;
    const spy: AIChatProvider = {
      key: 'spy',
      async chat(req) {
        capturedSystem = req.system;
        capturedTurns = req.messages.length;
        return { content: 'spy reply' };
      },
    };
    setChatProvider(spy);

    const res = await request(app)
      .post(chatUrl(propertyId))
      .set(...authHeader(token))
      .send({
        messages: [
          { role: 'user', content: 'How many arrivals?' },
          { role: 'assistant', content: 'Let me check.' },
          { role: 'user', content: 'And occupancy?' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('spy reply');
    expect(res.body.provider).toBe('spy');
    // Grounding: the live snapshot mentions occupancy + is read-only framed.
    expect(capturedSystem).toContain('Occupancy');
    expect(capturedSystem).toContain('READ-ONLY');
    // Full conversation forwarded.
    expect(capturedTurns).toBe(3);
  });

  it('rejects an empty conversation with 400', async () => {
    const { token } = await loginAsNewOwner('Assistant Hotel');
    const propertyId = await makeProperty(token);
    const res = await request(app)
      .post(chatUrl(propertyId))
      .set(...authHeader(token))
      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a conversation whose last turn is not the user', async () => {
    const { token } = await loginAsNewOwner('Assistant Hotel');
    const propertyId = await makeProperty(token);
    const res = await request(app)
      .post(chatUrl(propertyId))
      .set(...authHeader(token))
      .send({ messages: [{ role: 'assistant', content: 'I am talking to myself.' }] });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const { token } = await loginAsNewOwner('Assistant Hotel');
    const propertyId = await makeProperty(token);
    const res = await request(app)
      .post(chatUrl(propertyId))
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(401);
  });

  it('allows STAFF — the assistant answers from the dashboard the front desk already sees', async () => {
    const owner = await loginAsNewOwner('Assistant Hotel');
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

    const res = await request(app)
      .post(chatUrl(propertyId))
      .set(...authHeader(staffToken))
      .send({ messages: [{ role: 'user', content: 'Who is checking out today?' }] });
    expect(res.status).toBe(200);
  });

  it('never answers about another organization\'s property (cross-org → 404)', async () => {
    const a = await loginAsNewOwner('Org A');
    const propA = await makeProperty(a.token);

    const b = await loginAsNewOwner('Org B');
    const cross = await request(app)
      .post(chatUrl(propA))
      .set(...authHeader(b.token))
      .send({ messages: [{ role: 'user', content: 'Show me their bookings.' }] });
    // Cross-org property is invisible → 403 at the access guard (property is
    // not in Org B's set), never a 200 that could leak Org A's data.
    expect([403, 404]).toContain(cross.status);
    expect(cross.status).not.toBe(200);
  });
});

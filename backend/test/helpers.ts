import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createApp } from '../src/app.js';

export const app = createApp();

interface SignupResult {
  organizationId: string;
  ownerEmail: string;
  ownerPassword: string;
}

/** Creates a fresh, uniquely-slugged organization + OWNER user for a test. */
export async function signupOrganization(namePrefix = 'Test Hotel'): Promise<SignupResult> {
  const suffix = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${suffix}@example.com`;
  const ownerPassword = 'correct-horse-battery-staple';

  const res = await request(app)
    .post('/api/v1/organizations')
    .send({
      organizationName: `${namePrefix} ${suffix}`,
      organizationSlug: `test-hotel-${suffix}`,
      owner: { email: ownerEmail, password: ownerPassword, firstName: 'Test', lastName: 'Owner' },
    });

  if (res.status !== 201) {
    throw new Error(`signupOrganization failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { organizationId: res.body.organization.id as string, ownerEmail, ownerPassword };
}

/** Signs up a fresh organization and returns a ready-to-use access token for its OWNER. */
export async function loginAsNewOwner(namePrefix = 'Test Hotel'): Promise<{ token: string; organizationId: string }> {
  const { organizationId, ownerEmail, ownerPassword } = await signupOrganization(namePrefix);
  const res = await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: ownerPassword });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken as string, organizationId };
}

export function authHeader(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

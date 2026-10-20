import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { runWithRequestContext } from '../src/platform/tenancy/context.js';
import { scopedPrisma } from '../src/platform/tenancy/scoped-prisma.js';
import { systemContextForOrganization } from '../src/platform/jobs/system-context.js';
import { signupOrganization } from './helpers.js';

/**
 * The database itself (Postgres RLS), not just the app-layer filter, must
 * refuse cross-tenant access. Raw SQL on the scoped client bypasses the
 * Prisma where-injection entirely, so these assertions can only pass if the
 * `tenant_isolation` policies + `lc_app` role are doing the work.
 */
describe('Row Level Security', () => {
  it('raw SQL on the scoped client only ever sees the caller organization', async () => {
    const a = await signupOrganization('RLS A');
    const b = await signupOrganization('RLS B');

    const seen = await runWithRequestContext(systemContextForOrganization(a.organizationId), async () =>
      scopedPrisma.$queryRaw<{ organization_id: string }[]>(Prisma.sql`SELECT organization_id FROM users`),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((r) => r.organization_id))).toEqual(new Set([a.organizationId]));

    const orgs = await runWithRequestContext(systemContextForOrganization(a.organizationId), async () =>
      scopedPrisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM organizations`),
    );
    expect(orgs.map((o) => o.id)).toEqual([a.organizationId]);
    expect(orgs.map((o) => o.id)).not.toContain(b.organizationId);
  });

  it('the database rejects writing a row into another organization', async () => {
    const a = await signupOrganization('RLS W-A');
    const b = await signupOrganization('RLS W-B');
    await expect(
      runWithRequestContext(systemContextForOrganization(a.organizationId), async () =>
        scopedPrisma.$executeRaw(
          Prisma.sql`INSERT INTO guests (id, organization_id, first_name, last_name, updated_at) VALUES (gen_random_uuid()::text, ${b.organizationId}, 'X', 'Y', now())`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('interactive transactions run as the restricted role and cannot update other tenants', async () => {
    const a = await signupOrganization('RLS T-A');
    const b = await signupOrganization('RLS T-B');
    const result = await runWithRequestContext(systemContextForOrganization(a.organizationId), async () =>
      scopedPrisma.$transaction(async (tx) => {
        const who = await tx.$queryRaw<{ r: string }[]>(Prisma.sql`SELECT current_user AS r`);
        const updated = await tx.$executeRaw(
          Prisma.sql`UPDATE organizations SET name = 'pwned' WHERE id = ${b.organizationId}`,
        );
        return { role: who[0]?.r, updated };
      }),
    );
    expect(result.role).toBe('lc_app');
    expect(result.updated).toBe(0);
    const orgB = await prisma.organization.findUnique({ where: { id: b.organizationId } });
    expect(orgB?.name).not.toBe('pwned');
  });

  it('role and tenant settings do not leak onto the pooled connection afterwards', async () => {
    const a = await signupOrganization('RLS L');
    await runWithRequestContext(systemContextForOrganization(a.organizationId), async () =>
      scopedPrisma.guest.count(),
    );
    const rows = await prisma.$queryRaw<{ r: string; org: string | null }[]>(
      Prisma.sql`SELECT current_user AS r, NULLIF(current_setting('app.org_id', true), '') AS org`,
    );
    expect(rows[0]?.r).not.toBe('lc_app');
    expect(rows[0]?.org).toBeNull();
  });
});

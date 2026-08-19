import type { Organization } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { hashPassword } from '../../platform/auth/password.js';
import { assignSystemRole, ensurePermissionCatalog, seedSystemRoles } from '../../platform/rbac/provisioning.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import type { CreateOrganizationInput, UpdateOrganizationInput } from './schemas.js';

/**
 * The one organizations endpoint with no caller yet — bootstraps a brand
 * new tenant plus its OWNER user in a single transaction. Runs against
 * the base (unscoped) `prisma` client deliberately: there is no
 * organization to scope to before this call completes.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<{ organization: Organization }> {
  const [slugTaken, emailTaken] = await Promise.all([
    prisma.organization.findUnique({ where: { slug: input.organizationSlug } }),
    prisma.user.findUnique({ where: { email: input.owner.email } }),
  ]);
  if (slugTaken) {
    throw new ConflictError('That organization slug is already taken.');
  }
  if (emailTaken) {
    throw new ConflictError('That email is already in use.');
  }

  // Defensive, not primary: the seed script (`prisma/seed.ts`) is the
  // normal way the catalog gets populated in a deployed environment, but
  // a signup shouldn't hard-fail just because the seed step was skipped.
  await ensurePermissionCatalog();
  const passwordHash = await hashPassword(input.owner.password);

  // withUniqueConstraintGuard is the backstop for the race the pre-check
  // above can't fully close: two concurrent signups for the same
  // slug/email can both pass the pre-check before either commits.
  // Without it, the loser throws a raw Prisma error past this function
  // instead of the same 409 a sequential duplicate attempt gets.
  const organization = await withUniqueConstraintGuard(
    () =>
      prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: input.organizationName, slug: input.organizationSlug },
        });
        await seedSystemRoles(tx, org.id);

        const owner = await tx.user.create({
          data: {
            organizationId: org.id,
            email: input.owner.email,
            passwordHash,
            firstName: input.owner.firstName,
            lastName: input.owner.lastName,
            role: 'OWNER',
          },
        });
        await assignSystemRole(tx, { userId: owner.id, organizationId: org.id, roleName: 'OWNER' });

        return org;
      }),
    'That organization slug or owner email is already in use.',
  );

  return { organization };
}

/**
 * Reads/updates use the caller's own `organizationId` from the resolved
 * request context, never a client-supplied ID — an "update someone
 * else's org" request simply has no route parameter to attempt it
 * through.
 */
export async function getOwnOrganization(): Promise<Organization> {
  const ctx = getRequestContext();
  const organization = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
  if (!organization) {
    throw new NotFoundError();
  }
  return organization;
}

export async function updateOwnOrganization(input: UpdateOrganizationInput): Promise<Organization> {
  const ctx = getRequestContext();
  return prisma.organization.update({ where: { id: ctx.organizationId }, data: input });
}

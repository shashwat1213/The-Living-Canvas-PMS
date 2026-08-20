import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/http-errors.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { hashPassword } from '../../platform/auth/password.js';
import { bumpTokensValidAfter, deactivateUser } from '../../platform/auth/revocation.js';
import { ROLE_RANK, highestRoleRank, type SystemRoleName } from '../../platform/rbac/permissions.js';
import { assignSystemRole } from '../../platform/rbac/provisioning.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { staffRepository, type StaffMember } from './repository.js';
import type { PageMeta } from '../../lib/pagination.js';
import type { CreateStaffInput, ListStaffQuery, UpdateStaffInput } from './schemas.js';

/**
 * The role that actually governs a member's access. `roleNames` is the
 * real grant (via `UserRoleAssignment`); `User.role` is the display
 * label. They are kept in sync, but the grant is the one an audit entry
 * should report as the "before" value of a role change.
 */
function effectiveRoleOf(member: StaffMember): SystemRoleName {
  return (member.roleNames[0] ?? member.role) as SystemRoleName;
}

/**
 * The caller's own authority level, read from the signed access token's
 * resolved roles — never from the request body, and never from the
 * `User.role` label (which is a display preset, not the grant).
 */
function callerRank(): number {
  return highestRoleRank([...getRequestContext().roleNames]);
}

/**
 * Guards against handing out a role above your own — the escalation the
 * `staff:manage` permission by itself does not prevent. Without this, any
 * ADMIN could mint an OWNER and then act through it.
 */
function assertCanAssignRole(role: SystemRoleName): void {
  if (ROLE_RANK[role] > callerRank()) {
    throw new ForbiddenError("You can't assign a role above your own.");
  }
}

/**
 * Guards against acting on a staff member who is not strictly below you.
 *
 * The strictness matters in three separate ways, all covered by the one
 * comparison: you cannot act on someone senior to you, you cannot act on
 * a peer (one ADMIN demoting or locking out another), and you cannot act
 * on yourself — your own rank is never strictly below your own. That last
 * case is what keeps the account you're logged into from being the one
 * you accidentally demote or deactivate, and it's why an organization can
 * never end up with zero OWNERs: the only role that outranks OWNER is
 * nothing, so no request can ever remove the last one.
 *
 * The self case is checked explicitly first only to return a message that
 * says what actually happened; the rank rule alone would already reject it.
 */
function assertCanManage(target: StaffMember): void {
  const ctx = getRequestContext();
  if (target.id === ctx.userId) {
    throw new ForbiddenError("You can't change your own role, access, or account status.");
  }
  if (highestRoleRank(target.roleNames) >= callerRank()) {
    throw new ForbiddenError("You can't manage a staff member at or above your own role level.");
  }
}

async function requireStaff(userId: string): Promise<StaffMember> {
  const member = await staffRepository.findById(userId);
  if (!member) {
    // Same 404 for "no such user" and "user in another organization" —
    // see `lib/http-errors.ts` on why those must be indistinguishable.
    throw new NotFoundError('Staff member not found.');
  }
  return member;
}

/**
 * Resolves the given property IDs through the *scoped* client, which is
 * what stops a grant from pointing at another organization's property: a
 * cross-tenant ID simply doesn't come back, and the count mismatch turns
 * into a 404 before any PropertyAccess row is written. Same enforcement
 * shape the rooms repository uses for its parent-property lookup.
 */
async function assertPropertiesInOrganization(propertyIds: string[]): Promise<void> {
  if (propertyIds.length === 0) return;
  const found = await scopedPrisma.property.findMany({
    where: { id: { in: propertyIds } },
    select: { id: true },
  });
  if (found.length !== propertyIds.length) {
    throw new NotFoundError('One or more of those properties were not found.');
  }
}

export async function listStaff(query: ListStaffQuery): Promise<{ items: StaffMember[]; page: PageMeta }> {
  return staffRepository.list(query);
}

export async function getStaff(userId: string): Promise<StaffMember> {
  return requireStaff(userId);
}

export async function createStaff(input: CreateStaffInput): Promise<StaffMember> {
  const ctx = getRequestContext();
  assertCanAssignRole(input.role);

  const propertyIds = [...new Set(input.propertyIds ?? [])];
  await assertPropertiesInOrganization(propertyIds);

  // `User.email` is globally unique, not unique-per-organization, so this
  // check necessarily spans tenants. It reports the same "already in use"
  // message the public signup endpoint does rather than a more specific
  // one — see DECISIONS.md on why that tradeoff is accepted here.
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('That email is already in use.');
  }

  const passwordHash = await hashPassword(input.password);

  // The base (unscoped) client is used inside the transaction on purpose:
  // `organizationId` comes from the signed token's context, never from
  // the request body, and the only client-supplied IDs involved
  // (propertyIds) were already resolved through the scoped client above.
  // This mirrors how `organizations/service.ts` provisions its OWNER.
  const userId = await withUniqueConstraintGuard(
    () =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            organizationId: ctx.organizationId,
            email: input.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            role: input.role,
          },
        });
        await assignSystemRole(tx, {
          userId: user.id,
          organizationId: ctx.organizationId,
          roleName: input.role,
        });
        if (propertyIds.length > 0) {
          await tx.propertyAccess.createMany({
            data: propertyIds.map((propertyId) => ({ userId: user.id, propertyId })),
          });
        }

        // Inside the transaction: the audit entry and the account it
        // describes commit together, so there is no window in which one
        // exists without the other. Note the absence of `input.password` —
        // the recorder also strips credential-shaped keys as a backstop.
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.STAFF_CREATED,
            entityType: AUDIT_ENTITY_TYPES.STAFF,
            entityId: user.id,
            metadata: { email: input.email, role: input.role, propertyIds },
          },
          tx,
        );

        return user.id;
      }),
    'That email is already in use.',
  );

  return requireStaff(userId);
}

export async function updateStaff(userId: string, input: UpdateStaffInput): Promise<StaffMember> {
  const ctx = getRequestContext();
  const target = await requireStaff(userId);
  assertCanManage(target);
  if (input.role !== undefined) {
    assertCanAssignRole(input.role);
  }

  const previousRole = effectiveRoleOf(target);

  await prisma.$transaction(async (tx) => {
    const data: Prisma.UserUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.role !== undefined) data.role = input.role;
    // Only reactivation is a plain write. Deactivation is handled below
    // through `deactivateUser`, which also kills tokens and sessions —
    // writing `isActive: false` here instead would be exactly the
    // half-done offboarding that function exists to prevent.
    if (input.isActive === true) data.isActive = true;

    if (Object.keys(data).length > 0) {
      // `userId` was already proven to be in the caller's organization by
      // `requireStaff` above (scoped read), so this unscoped write can't
      // reach another tenant's row.
      await tx.user.update({ where: { id: userId }, data });
    }

    if (input.role !== undefined) {
      // Replace rather than add: a user holds exactly one system role
      // preset, and `assignSystemRole` would otherwise stack a second one
      // on top, leaving the union of both roles' permissions in effect.
      await tx.userRoleAssignment.deleteMany({ where: { userId } });
      await assignSystemRole(tx, { userId, organizationId: ctx.organizationId, roleName: input.role });
    }

    // One request can legitimately be several audited events (a rename
    // and a role change arrive together), so each is recorded separately
    // rather than collapsed into one vague "updated" entry.
    if (input.firstName !== undefined || input.lastName !== undefined) {
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.STAFF_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.STAFF,
          entityId: userId,
          metadata: {
            from: { firstName: target.firstName, lastName: target.lastName },
            to: {
              firstName: input.firstName ?? target.firstName,
              lastName: input.lastName ?? target.lastName,
            },
          },
        },
        tx,
      );
    }

    if (input.role !== undefined && input.role !== previousRole) {
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.STAFF_ROLE_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.STAFF,
          entityId: userId,
          metadata: { from: previousRole, to: input.role },
        },
        tx,
      );
    }

    // Reactivation is a plain write inside this transaction, so its audit
    // entry belongs here too. Deactivation is recorded after the fact —
    // see below.
    if (input.isActive === true && !target.isActive) {
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.STAFF_REACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.STAFF,
          entityId: userId,
          metadata: { email: target.email },
        },
        tx,
      );
    }
  });

  // A role change rewrites what the user may do, but their already-issued
  // access token still carries the OLD permission list until it expires
  // (up to 15 minutes). Bumping the watermark makes the demotion take
  // effect on their very next request instead — this is precisely what
  // `platform/auth/revocation.ts` was built for. Their next silent
  // refresh mints a token with the new permissions, so a *promotion*
  // costs one extra round-trip rather than a forced logout.
  if (input.role !== undefined) {
    await bumpTokensValidAfter(userId);
  }
  if (input.isActive === false) {
    // Deactivation and its audit entry commit together. `deactivateUser`
    // takes the transaction client so its user-update and session-revoke
    // join it too — the whole offboarding is one atomic act, and there is
    // no window in which someone is locked out with no record of who did
    // it. (Its cache eviction stays outside the transaction by design;
    // see `platform/auth/revocation.ts`.)
    await prisma.$transaction(async (tx) => {
      await deactivateUser(userId, tx);
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.STAFF_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.STAFF,
          entityId: userId,
          metadata: { email: target.email },
        },
        tx,
      );
    });
  }

  return requireStaff(userId);
}

/**
 * Replaces a staff member's property grants with exactly the given set.
 *
 * There is deliberately no add/remove pair: the access token embeds
 * `grantedPropertyIds`, so every change has to be followed by a watermark
 * bump anyway, and a whole-set write makes the resulting state obvious
 * from the request instead of dependent on what was there before.
 */
export async function setPropertyAccess(userId: string, requestedPropertyIds: string[]): Promise<StaffMember> {
  const target = await requireStaff(userId);
  assertCanManage(target);

  const propertyIds = [...new Set(requestedPropertyIds)];
  await assertPropertiesInOrganization(propertyIds);

  const previousPropertyIds = target.propertyIds;
  const added = propertyIds.filter((id) => !previousPropertyIds.includes(id));
  const removed = previousPropertyIds.filter((id) => !propertyIds.includes(id));

  await prisma.$transaction(async (tx) => {
    await tx.propertyAccess.deleteMany({ where: { userId } });
    if (propertyIds.length > 0) {
      await tx.propertyAccess.createMany({
        data: propertyIds.map((propertyId) => ({ userId, propertyId })),
      });
    }

    // Only when the grant set actually moved: this endpoint is a
    // whole-set write, so a client re-sending the current set is a no-op
    // and does not deserve an audit entry.
    if (added.length > 0 || removed.length > 0) {
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.STAFF_PROPERTY_ACCESS_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.STAFF,
          entityId: userId,
          metadata: { added, removed, resulting: propertyIds },
        },
        tx,
      );
    }
  });

  // Same reasoning as the role change above: the token carries the old
  // grant list, so revoking access has to invalidate it to mean anything.
  await bumpTokensValidAfter(userId);

  return requireStaff(userId);
}

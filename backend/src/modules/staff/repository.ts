import type { Prisma } from '@prisma/client';

import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { SystemRoleName } from '../../platform/rbac/permissions.js';

/**
 * The exact columns a staff record may leave the backend with.
 *
 * This is an allowlist, not a convenience: `User` also carries
 * `passwordHash` and `tokensValidAfter`, and a default `include`-style
 * read would put both in an API response. Adding a column to the `User`
 * model must not silently start publishing it — anything new has to be
 * named here first.
 */
const staffSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  roleAssignments: { select: { role: { select: { name: true } } } },
  propertyAccess: { select: { propertyId: true } },
} satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

export interface StaffMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** The coarse UI-facing preset on `User.role`. */
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * The roles actually driving this user's authorization, resolved from
   * `UserRoleAssignment`. Exposed alongside `role` rather than folded
   * into it because they are two different facts: `role` is the label,
   * this is the grant. If they ever disagree, an admin UI showing both is
   * how that becomes visible instead of silently misreporting access.
   */
  roleNames: SystemRoleName[];
  /** Property IDs this user holds an explicit PropertyAccess grant for. */
  propertyIds: string[];
}

function toStaffMember(row: StaffRow): StaffMember {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    roleNames: row.roleAssignments.map((assignment) => assignment.role.name as SystemRoleName),
    propertyIds: row.propertyAccess.map((grant) => grant.propertyId),
  };
}

/**
 * Every read here goes through `scopedPrisma`, never the base `prisma`
 * client — that's what makes the organization filter impossible to
 * forget (see `platform/tenancy/scoped-prisma.ts`). A `userId` belonging
 * to another organization resolves to `null` here, which the service
 * turns into the same 404 a nonexistent ID gets.
 *
 * Note the `findFirst` (not `findUnique`) in `findById`: the scoping
 * extension injects `organizationId` into the where-clause, which Prisma
 * rejects inside a `findUnique`. Same rule the properties and rooms
 * repositories follow.
 */
export const staffRepository = {
  async list(): Promise<StaffMember[]> {
    const rows = await scopedPrisma.user.findMany({
      select: staffSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toStaffMember);
  },

  async findById(id: string): Promise<StaffMember | null> {
    const row = await scopedPrisma.user.findFirst({ where: { id }, select: staffSelect });
    return row ? toStaffMember(row) : null;
  },
};

import type { Prisma } from '@prisma/client';

import { toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { buildPageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { SystemRoleName } from '../../platform/rbac/permissions.js';
import type { ListStaffQuery } from './schemas.js';

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
/**
 * Translates the validated query into a Prisma filter.
 *
 * Note what is absent: any mention of `organizationId`. The tenant filter
 * is injected by the scoping extension and ANDed with whatever is
 * returned here, so a filter can never widen the caller's visibility —
 * only narrow it further within their own organization.
 */
function buildWhere(query: ListStaffQuery): Prisma.UserWhereInput {
  const conditions: Prisma.UserWhereInput[] = [];

  if (query.role) {
    // Matched against the actual role assignment rather than the `role`
    // label, so the filter agrees with what really governs access.
    conditions.push({ roleAssignments: { some: { role: { name: query.role } } } });
  }

  if (query.status) {
    conditions.push({ isActive: query.status === 'ACTIVE' });
  }

  if (query.search) {
    // Each whitespace-separated term must match at least one field, so
    // "mary manager" finds Mary Manager even though the name is split
    // across two columns — a single OR over the raw string would not.
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

export const staffRepository = {
  /**
   * One page of staff, plus the metadata needed to render pagination.
   *
   * The count and the page are issued in a single transaction so the
   * total can't be taken from a different instant than the rows — a
   * concurrent signup would otherwise produce a page that disagrees with
   * its own "of N" label.
   *
   * Ordering includes `id` as a tiebreaker: `createdAt` alone is not
   * unique, and two rows sharing a timestamp could otherwise appear on
   * two different pages, or on neither.
   */
  async list(query: ListStaffQuery): Promise<{ items: StaffMember[]; page: PageMeta }> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.user.count({ where }),
      scopedPrisma.user.findMany({
        where,
        select: staffSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(toStaffMember), page: buildPageMeta(query, totalItems) };
  },

  async findById(id: string): Promise<StaffMember | null> {
    const row = await scopedPrisma.user.findFirst({ where: { id }, select: staffSelect });
    return row ? toStaffMember(row) : null;
  },
};

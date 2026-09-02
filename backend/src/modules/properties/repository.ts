import type { Prisma, Property } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreatePropertyInput, ListPropertiesQuery, UpdatePropertyInput } from './schemas.js';

/**
 * Restricts a listing to a specific set of property IDs. Supplied by the
 * service for callers without an organization-wide role, so the
 * PropertyAccess filter runs *in the query* rather than over an
 * already-paginated result — see `service.ts` for why that distinction
 * is load-bearing rather than stylistic.
 */
export interface PropertyAccessFilter {
  allowedIds: string[];
}

/** No `organizationId` here — the scoping extension ANDs it in. */
function buildWhere(query: ListPropertiesQuery, access?: PropertyAccessFilter): Prisma.PropertyWhereInput {
  const conditions: Prisma.PropertyWhereInput[] = [];

  if (access) {
    conditions.push({ id: { in: access.allowedIds } });
  }
  if (query.status) {
    conditions.push({ isActive: query.status === 'ACTIVE' });
  }
  if (query.search) {
    // Same every-term-must-match rule as the staff search, so a
    // multi-word query narrows instead of widening.
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
          { city: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

/**
 * The client a repository method runs on: the tenant-scoped client, or
 * the transaction client from `scopedPrisma.$transaction` — the scoping
 * extension propagates into transactions, so tenancy is enforced either
 * way. Typed as a `Pick` of the models used so both satisfy it.
 *
 * Callers pass a transaction when the write has to commit together with
 * something else (an audit entry); everything else takes the default.
 */
export type PropertiesDb = Pick<typeof scopedPrisma, 'property' | 'room'>;

/**
 * Every method here goes through `scopedPrisma` (or a transaction of it),
 * never the base `prisma` client — that's what makes the organization
 * filter impossible to forget (see `platform/tenancy/scoped-prisma.ts`).
 */
export const propertiesRepository = {
  /**
   * One page of properties. Count and rows share a transaction so the
   * total can't be read from a different instant than the page it
   * labels; `id` breaks ties on `createdAt` so rows can't straddle or
   * fall between pages.
   */
  async list(
    query: ListPropertiesQuery,
    access?: PropertyAccessFilter,
  ): Promise<{ items: Property[]; page: PageMeta }> {
    const where = buildWhere(query, access);
    const { skip, take } = toSkipTake(query);

    const [totalItems, items] = await scopedPrisma.$transaction([
      scopedPrisma.property.count({ where }),
      scopedPrisma.property.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items, page: buildPageMeta(query, totalItems) };
  },

  findById(id: string): Promise<Property | null> {
    return scopedPrisma.property.findFirst({ where: { id } });
  },

  findBySlug(slug: string): Promise<Property | null> {
    return scopedPrisma.property.findFirst({ where: { slug } });
  },

  /** Rooms that would cascade if this property were deleted. */
  countRooms(propertyId: string): Promise<number> {
    return scopedPrisma.room.count({ where: { propertyId } });
  },

  create(data: CreatePropertyInput, db: PropertiesDb = scopedPrisma): Promise<Property> {
    // `organizationId` is required by Prisma's generated type but is
    // injected at runtime by the tenant-scoping extension's `create`
    // handling (scoped-prisma.ts) — the cast reflects that seam, not a
    // missing field.
    return db.property.create({ data: data as Prisma.PropertyCreateInput });
  },

  async update(id: string, data: UpdatePropertyInput, db: PropertiesDb = scopedPrisma): Promise<Property> {
    try {
      return await db.property.update({ where: { id }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Property not found.');
      }
      throw error;
    }
  },

  async remove(id: string, db: PropertiesDb = scopedPrisma): Promise<void> {
    try {
      await db.property.delete({ where: { id } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Property not found.');
      }
      throw error;
    }
  },
};

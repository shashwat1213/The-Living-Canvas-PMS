import type { Guest, Prisma } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateGuestInput, ListGuestsQuery, UpdateGuestInput } from './schemas.js';

/** A guest plus how many reservations reference them. */
export interface GuestWithUsage extends Guest {
  reservationCount: number;
}

/** No `organizationId` here — the scoping extension ANDs it in. */
function buildWhere(query: ListGuestsQuery): Prisma.GuestWhereInput {
  const conditions: Prisma.GuestWhereInput[] = [];

  if (query.search) {
    // Every term must match (across the guest's fields), so a multi-word
    // query narrows rather than widens — the same rule staff/property search
    // uses. A full name spanning first + last still finds one person.
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

export type GuestsDb = Pick<typeof scopedPrisma, 'guest'>;

const withUsage = { _count: { select: { reservations: true } } } satisfies Prisma.GuestInclude;
type GuestRow = Prisma.GuestGetPayload<{ include: typeof withUsage }>;

function toGuest({ _count, ...guest }: GuestRow): GuestWithUsage {
  return { ...guest, reservationCount: _count.reservations };
}

export const guestsRepository = {
  async list(query: ListGuestsQuery): Promise<{ items: GuestWithUsage[]; page: PageMeta }> {
    const where = buildWhere(query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.guest.count({ where }),
      scopedPrisma.guest.findMany({
        where,
        include: withUsage,
        // Alphabetical by last then first name — how a guest directory reads.
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(toGuest), page: buildPageMeta(query, totalItems) };
  },

  async findById(id: string): Promise<GuestWithUsage | null> {
    const row = await scopedPrisma.guest.findFirst({ where: { id }, include: withUsage });
    return row ? toGuest(row) : null;
  },

  /** Existing guests with this email, for the duplicate-profile check. */
  findByEmail(email: string): Promise<Guest[]> {
    return scopedPrisma.guest.findMany({ where: { email } });
  },

  create(data: CreateGuestInput, db: GuestsDb = scopedPrisma): Promise<Guest> {
    // `organizationId` is injected at runtime by the tenant-scoping
    // extension's `create` handling — the cast reflects that seam.
    return db.guest.create({ data: data as Prisma.GuestCreateInput });
  },

  async update(id: string, data: UpdateGuestInput, db: GuestsDb = scopedPrisma): Promise<Guest> {
    try {
      return await db.guest.update({ where: { id }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Guest not found.');
      }
      throw error;
    }
  },

  async remove(id: string, db: GuestsDb = scopedPrisma): Promise<void> {
    try {
      await db.guest.delete({ where: { id } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Guest not found.');
      }
      throw error;
    }
  },
};

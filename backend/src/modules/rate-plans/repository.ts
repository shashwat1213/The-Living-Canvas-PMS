import type { Prisma, RatePlan, RatePlanRate } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateRatePlanInput, ListRatePlansQuery, UpdateRatePlanInput } from './schemas.js';

/** A rate plan plus how many dates currently have a price set. */
export interface RatePlanWithUsage extends RatePlan {
  pricedDates: number;
}

function buildWhere(roomTypeId: string, query: ListRatePlansQuery): Prisma.RatePlanWhereInput {
  const conditions: Prisma.RatePlanWhereInput[] = [{ roomTypeId }];

  if (query.status) {
    conditions.push({ isActive: query.status === 'ACTIVE' });
  }
  if (query.search) {
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { code: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  return { AND: conditions };
}

/**
 * The surface a rate-plan operation touches: rate plans and their rates,
 * plus `roomType` so the parent can be resolved through the scoped client to
 * enforce the tenant boundary on create (RatePlan has no `organizationId`
 * column of its own — see `scoped-prisma.ts`). Satisfied by the scoped client
 * or a transaction of it.
 */
export type RatePlansDb = Pick<typeof scopedPrisma, 'ratePlan' | 'ratePlanRate' | 'roomType'>;

const withUsage = { _count: { select: { rates: true } } } satisfies Prisma.RatePlanInclude;
type RatePlanRow = Prisma.RatePlanGetPayload<{ include: typeof withUsage }>;

function toRatePlan({ _count, ...ratePlan }: RatePlanRow): RatePlanWithUsage {
  return { ...ratePlan, pricedDates: _count.rates };
}

/**
 * Resolves the parent RoomType through the *scoped* client and confirms it
 * belongs to the property in the URL. This is the tenant + parent-ownership
 * boundary for every rate-plan operation: a room-type id from another
 * property (same org) or another organization resolves to nothing and 404s
 * before any rate-plan row is read or written — the caller learns only that
 * this property has no such type, the same signal `rooms` gives.
 */
async function assertRoomType(propertyId: string, roomTypeId: string, db: RatePlansDb): Promise<void> {
  const roomType = await db.roomType.findFirst({ where: { id: roomTypeId, propertyId } });
  if (!roomType) {
    throw new NotFoundError('Room type not found.');
  }
}

export const ratePlansRepository = {
  async list(
    propertyId: string,
    roomTypeId: string,
    query: ListRatePlansQuery,
  ): Promise<{ items: RatePlanWithUsage[]; page: PageMeta }> {
    await assertRoomType(propertyId, roomTypeId, scopedPrisma);

    const where = buildWhere(roomTypeId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.ratePlan.count({ where }),
      scopedPrisma.ratePlan.findMany({
        where,
        include: withUsage,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(toRatePlan), page: buildPageMeta(query, totalItems) };
  },

  async findById(propertyId: string, roomTypeId: string, id: string): Promise<RatePlanWithUsage | null> {
    const row = await scopedPrisma.ratePlan.findFirst({ where: { id, roomTypeId }, include: withUsage });
    if (!row) return null;
    // A rate plan can only be reached through its own room type + property.
    await assertRoomType(propertyId, roomTypeId, scopedPrisma);
    return toRatePlan(row);
  },

  findByName(roomTypeId: string, name: string): Promise<RatePlan | null> {
    return scopedPrisma.ratePlan.findFirst({ where: { roomTypeId, name } });
  },

  findByCode(roomTypeId: string, code: string): Promise<RatePlan | null> {
    return scopedPrisma.ratePlan.findFirst({ where: { roomTypeId, code } });
  },

  async create(
    propertyId: string,
    roomTypeId: string,
    data: CreateRatePlanInput,
    db: RatePlansDb = scopedPrisma,
  ): Promise<RatePlan> {
    await assertRoomType(propertyId, roomTypeId, db);
    return db.ratePlan.create({ data: { ...data, roomTypeId } });
  },

  async update(
    roomTypeId: string,
    id: string,
    data: UpdateRatePlanInput,
    db: RatePlansDb = scopedPrisma,
  ): Promise<RatePlan> {
    try {
      return await db.ratePlan.update({ where: { id, roomTypeId }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Rate plan not found.');
      }
      throw error;
    }
  },

  async remove(roomTypeId: string, id: string, db: RatePlansDb = scopedPrisma): Promise<void> {
    try {
      await db.ratePlan.delete({ where: { id, roomTypeId } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Rate plan not found.');
      }
      throw error;
    }
  },

  /** The per-date rates of one plan within an inclusive [from, to] window. */
  listRates(ratePlanId: string, from: Date, to: Date): Promise<RatePlanRate[]> {
    return scopedPrisma.ratePlanRate.findMany({
      where: { ratePlanId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
  },
};

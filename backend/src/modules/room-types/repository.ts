import type { Prisma, RoomType } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateRoomTypeInput, ListRoomTypesQuery, UpdateRoomTypeInput } from './schemas.js';

/** A room type plus how many rooms currently point at it. */
export interface RoomTypeWithUsage extends RoomType {
  roomCount: number;
}

/**
 * `propertyId` is always present; tenancy is enforced separately by the
 * scoping extension, which reaches RoomType through its `property`
 * relation — the same arrangement `Room` uses.
 */
function buildWhere(propertyId: string, query: ListRoomTypesQuery): Prisma.RoomTypeWhereInput {
  const conditions: Prisma.RoomTypeWhereInput[] = [{ propertyId }];

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

/** Same contract as `RoomsDb` — the scoped client or a transaction of it. */
export type RoomTypesDb = Pick<typeof scopedPrisma, 'roomType' | 'property' | 'room'>;

const withUsage = { _count: { select: { rooms: true } } } satisfies Prisma.RoomTypeInclude;

type RoomTypeRow = Prisma.RoomTypeGetPayload<{ include: typeof withUsage }>;

function toRoomType({ _count, ...roomType }: RoomTypeRow): RoomTypeWithUsage {
  return { ...roomType, roomCount: _count.rooms };
}

export const roomTypesRepository = {
  /**
   * Verifies the parent Property first, for the same reason the rooms
   * repository does: a property ID from another organization must 404
   * rather than silently list as an empty page, which is what every other
   * property sub-route does.
   *
   * Ordered by name — a room-type catalogue is read alphabetically, not
   * by when someone happened to create each entry. `id` breaks ties so a
   * row can't straddle two pages.
   */
  async list(propertyId: string, query: ListRoomTypesQuery): Promise<{ items: RoomTypeWithUsage[]; page: PageMeta }> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }

    const where = buildWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.roomType.count({ where }),
      scopedPrisma.roomType.findMany({
        where,
        include: withUsage,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows.map(toRoomType), page: buildPageMeta(query, totalItems) };
  },

  async findById(propertyId: string, id: string): Promise<RoomTypeWithUsage | null> {
    const row = await scopedPrisma.roomType.findFirst({ where: { id, propertyId }, include: withUsage });
    return row ? toRoomType(row) : null;
  },

  findByName(propertyId: string, name: string): Promise<RoomType | null> {
    return scopedPrisma.roomType.findFirst({ where: { propertyId, name } });
  },

  findByCode(propertyId: string, code: string): Promise<RoomType | null> {
    return scopedPrisma.roomType.findFirst({ where: { propertyId, code } });
  },

  /**
   * RoomType has no `organizationId` column to scope a `create` by, so —
   * exactly as in `rooms/repository.ts` — the tenant boundary is enforced
   * by resolving the parent Property through the *scoped* client first. A
   * cross-organization `propertyId` resolves to nothing and throws before
   * any row is written.
   */
  async create(propertyId: string, data: CreateRoomTypeInput, db: RoomTypesDb = scopedPrisma): Promise<RoomType> {
    const property = await db.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
    return db.roomType.create({ data: { ...data, propertyId } });
  },

  async update(
    propertyId: string,
    id: string,
    data: UpdateRoomTypeInput,
    db: RoomTypesDb = scopedPrisma,
  ): Promise<RoomType> {
    try {
      return await db.roomType.update({ where: { id, propertyId }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Room type not found.');
      }
      throw error;
    }
  },

  async remove(propertyId: string, id: string, db: RoomTypesDb = scopedPrisma): Promise<void> {
    try {
      await db.roomType.delete({ where: { id, propertyId } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Room type not found.');
      }
      throw error;
    }
  },
};

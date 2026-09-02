import type { Prisma, Room } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateRoomInput, ListRoomsQuery, UpdateRoomInput } from './schemas.js';

/**
 * `propertyId` is always present; tenancy is enforced separately by the
 * scoping extension, which reaches Room through its `property` relation.
 */
function buildWhere(propertyId: string, query: ListRoomsQuery): Prisma.RoomWhereInput {
  const conditions: Prisma.RoomWhereInput[] = [{ propertyId }];

  if (query.status) {
    conditions.push({ status: query.status });
  }
  if (query.search) {
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { roomType: { contains: term, mode: 'insensitive' } },
          { floor: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  return { AND: conditions };
}

/**
 * Same contract as `PropertiesDb` — scoped client or a transaction of it.
 * `roomType` is included so a room's type link can be validated inside the
 * same transaction that writes it (see `rooms/service.ts`).
 */
export type RoomsDb = Pick<typeof scopedPrisma, 'room' | 'property' | 'roomType'>;

/**
 * What a room is actually written with. `roomType` is optional on the
 * request (a caller may send `roomTypeId` instead) but not on the row —
 * the column is NOT NULL — so the service resolves one before reaching
 * here, and this type is what makes that a compile-time obligation rather
 * than a convention.
 */
export type CreateRoomData = CreateRoomInput & { roomType: string };

export const roomsRepository = {
  /**
   * Verifies the parent Property exists (within the caller's org) before
   * listing, same as `create` below — without this, a property ID from
   * another organization would silently list as an empty page (200)
   * instead of 404, which is not a data leak (tenant scoping still zeroes
   * the result) but is an inconsistent signal next to every other
   * property sub-route, which does 404 on a cross-org ID.
   *
   * Rooms sort by name rather than creation date: "101, 102, 103" is the
   * order a property's rooms are actually thought about, and pagination
   * makes that ordering visible in a way an unpaginated list didn't.
   */
  async list(propertyId: string, query: ListRoomsQuery): Promise<{ items: Room[]; page: PageMeta }> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }

    const where = buildWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, items] = await scopedPrisma.$transaction([
      scopedPrisma.room.count({ where }),
      scopedPrisma.room.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items, page: buildPageMeta(query, totalItems) };
  },

  findById(propertyId: string, id: string): Promise<Room | null> {
    return scopedPrisma.room.findFirst({ where: { id, propertyId } });
  },

  findByName(propertyId: string, name: string): Promise<Room | null> {
    return scopedPrisma.room.findFirst({ where: { propertyId, name } });
  },

  /**
   * Room has no `organizationId` column to scope a `create` by (see
   * `scoped-prisma.ts`'s comment on the room block), so this is where
   * the tenant boundary actually gets enforced for room creation: the
   * parent Property is looked up through the *scoped* client first — a
   * cross-organization `propertyId` resolves to nothing here and throws
   * `NotFoundError` before any room row is ever written.
   */
  async create(propertyId: string, data: CreateRoomData, db: RoomsDb = scopedPrisma): Promise<Room> {
    const property = await db.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
    return db.room.create({ data: { ...data, propertyId } });
  },

  async update(propertyId: string, id: string, data: UpdateRoomInput, db: RoomsDb = scopedPrisma): Promise<Room> {
    try {
      return await db.room.update({ where: { id, propertyId }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Room not found.');
      }
      throw error;
    }
  },

  async remove(propertyId: string, id: string, db: RoomsDb = scopedPrisma): Promise<void> {
    try {
      await db.room.delete({ where: { id, propertyId } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Room not found.');
      }
      throw error;
    }
  },
};

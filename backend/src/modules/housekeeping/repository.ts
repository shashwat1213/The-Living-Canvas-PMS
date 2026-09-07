import type { Prisma } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateTaskInput, ListTasksQuery } from './schemas.js';

/**
 * A task is returned with the room it's on (name/floor/type) and the staff
 * member it's assigned to embedded, so the board and task list read at a
 * glance without a second lookup. `passwordHash` is never in the assignee
 * projection — only identity fields.
 */
const taskInclude = {
  room: {
    select: {
      id: true,
      name: true,
      floor: true,
      roomType: { select: { id: true, name: true, code: true } },
    },
  },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.HousekeepingTaskInclude;

export type HousekeepingTaskRow = Prisma.HousekeepingTaskGetPayload<{ include: typeof taskInclude }>;

/** Rooms as the board needs them: identity, both status axes, and type. */
const boardRoomSelect = {
  id: true,
  name: true,
  floor: true,
  status: true,
  housekeepingStatus: true,
  roomType: { select: { id: true, name: true, code: true } },
} satisfies Prisma.RoomSelect;

export type BoardRoomRow = Prisma.RoomGetPayload<{ select: typeof boardRoomSelect }>;

/** A reservation as the board needs it to derive occupancy for one date. */
export interface BoardReservationRow {
  id: string;
  roomId: string | null;
  status: string;
  checkIn: Date;
  checkOut: Date;
}

/** Scoped client or a transaction of it — same convention as the other modules. */
export type HousekeepingDb = Pick<typeof scopedPrisma, 'housekeepingTask' | 'room' | 'property' | 'user' | 'reservation'>;

function buildTaskWhere(propertyId: string, query: ListTasksQuery): Prisma.HousekeepingTaskWhereInput {
  const conditions: Prisma.HousekeepingTaskWhereInput[] = [{ room: { propertyId } }];
  if (query.status) conditions.push({ status: query.status });
  if (query.type) conditions.push({ type: query.type });
  if (query.roomId) conditions.push({ roomId: query.roomId });
  if (query.assignedToId) conditions.push({ assignedToId: query.assignedToId });
  return { AND: conditions };
}

export const housekeepingRepository = {
  /** Verifies the parent property is visible to the caller (cross-org → 404). */
  async requireProperty(propertyId: string, db: HousekeepingDb = scopedPrisma): Promise<void> {
    const property = await db.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  /** Every room at the property, as the board renders them. */
  listBoardRooms(propertyId: string, db: HousekeepingDb = scopedPrisma): Promise<BoardRoomRow[]> {
    return db.room.findMany({
      where: { propertyId },
      select: boardRoomSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  },

  /**
   * Reservations assigned to a room at this property that touch [date] — i.e.
   * checkIn <= date <= checkOut, occupying statuses only. The `checkOut ===
   * date` boundary is included on purpose so a departure shows on the board on
   * its checkout day (the room to turn over today).
   */
  boardReservationsOn(propertyId: string, date: Date, db: HousekeepingDb = scopedPrisma): Promise<BoardReservationRow[]> {
    return db.reservation.findMany({
      where: {
        propertyId,
        roomId: { not: null },
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] },
        checkIn: { lte: date },
        checkOut: { gte: date },
      },
      select: { id: true, roomId: true, status: true, checkIn: true, checkOut: true },
    });
  },

  /** Open task counts grouped by room, for the board's per-room task badge. */
  async openTaskCountsByRoom(propertyId: string, db: HousekeepingDb = scopedPrisma): Promise<Map<string, number>> {
    const rows = await db.housekeepingTask.groupBy({
      by: ['roomId'],
      where: { room: { propertyId }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.roomId, r._count._all]));
  },

  async listTasks(propertyId: string, query: ListTasksQuery): Promise<{ items: HousekeepingTaskRow[]; page: PageMeta }> {
    await this.requireProperty(propertyId);
    const where = buildTaskWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, items] = await scopedPrisma.$transaction([
      scopedPrisma.housekeepingTask.count({ where }),
      scopedPrisma.housekeepingTask.findMany({
        where,
        include: taskInclude,
        // Open work first, then newest — the order a supervisor works the list.
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items, page: buildPageMeta(query, totalItems) };
  },

  findTaskById(propertyId: string, id: string, db: HousekeepingDb = scopedPrisma): Promise<HousekeepingTaskRow | null> {
    return db.housekeepingTask.findFirst({ where: { id, room: { propertyId } }, include: taskInclude });
  },

  /** The room, scoped to the property — used to validate a task's target. */
  findRoom(
    propertyId: string,
    roomId: string,
    db: HousekeepingDb = scopedPrisma,
  ): Promise<{ id: string; name: string; housekeepingStatus: string } | null> {
    return db.room.findFirst({
      where: { id: roomId, propertyId },
      select: { id: true, name: true, housekeepingStatus: true },
    });
  },

  /** Confirms a staff member belongs to the caller's organization (scoped). */
  findStaff(userId: string, db: HousekeepingDb = scopedPrisma): Promise<{ id: string } | null> {
    return db.user.findFirst({ where: { id: userId }, select: { id: true } });
  },

  createTask(data: CreateTaskInput & { type: string }, db: HousekeepingDb = scopedPrisma): Promise<HousekeepingTaskRow> {
    return db.housekeepingTask.create({
      data: {
        roomId: data.roomId,
        type: data.type as never,
        assignedToId: data.assignedToId ?? null,
        notes: data.notes ?? null,
      },
      include: taskInclude,
    });
  },

  async updateTask(
    propertyId: string,
    id: string,
    data: Prisma.HousekeepingTaskUpdateInput,
    db: HousekeepingDb = scopedPrisma,
  ): Promise<HousekeepingTaskRow> {
    try {
      // The `where` carries the property relation so a cross-property/tenant
      // id can't be updated — the scoping extension adds the org filter too.
      await db.housekeepingTask.update({ where: { id, room: { propertyId } }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Housekeeping task not found.');
      }
      throw error;
    }
    // Re-read with the full include for a consistent return shape.
    const row = await this.findTaskById(propertyId, id, db);
    if (!row) throw new NotFoundError('Housekeeping task not found.');
    return row;
  },

  setRoomCondition(
    propertyId: string,
    roomId: string,
    housekeepingStatus: string,
    db: HousekeepingDb = scopedPrisma,
  ): Promise<{ id: string }> {
    return db.room.update({
      where: { id: roomId, propertyId },
      data: { housekeepingStatus: housekeepingStatus as never },
      select: { id: true },
    });
  },
};

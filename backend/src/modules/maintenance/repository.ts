import type { Prisma } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { ListWorkOrdersQuery } from './schemas.js';

/**
 * A work order is returned with the room it's about (if any) and the engineer
 * it's assigned to embedded. The assignee projection is identity-only — never
 * `passwordHash`.
 */
const workOrderInclude = {
  room: { select: { id: true, name: true, floor: true, status: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.MaintenanceWorkOrderInclude;

export type WorkOrderRow = Prisma.MaintenanceWorkOrderGetPayload<{ include: typeof workOrderInclude }>;

/** Scoped client or a transaction of it — same convention as the other modules. */
export type MaintenanceDb = Pick<typeof scopedPrisma, 'maintenanceWorkOrder' | 'room' | 'property' | 'user'>;

function buildWhere(propertyId: string, query: ListWorkOrdersQuery): Prisma.MaintenanceWorkOrderWhereInput {
  const conditions: Prisma.MaintenanceWorkOrderWhereInput[] = [{ propertyId }];
  if (query.status) conditions.push({ status: query.status });
  if (query.priority) conditions.push({ priority: query.priority });
  if (query.category) conditions.push({ category: query.category });
  if (query.roomId) conditions.push({ roomId: query.roomId });
  if (query.assignedToId) conditions.push({ assignedToId: query.assignedToId });
  if (query.search) {
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { room: { name: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
  }
  return { AND: conditions };
}

export const maintenanceRepository = {
  /** Verifies the parent property is visible to the caller (cross-org → 404). */
  async requireProperty(propertyId: string, db: MaintenanceDb = scopedPrisma): Promise<void> {
    const property = await db.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  async list(propertyId: string, query: ListWorkOrdersQuery): Promise<{ items: WorkOrderRow[]; page: PageMeta }> {
    await this.requireProperty(propertyId);
    const where = buildWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, items] = await scopedPrisma.$transaction([
      scopedPrisma.maintenanceWorkOrder.count({ where }),
      scopedPrisma.maintenanceWorkOrder.findMany({
        where,
        include: workOrderInclude,
        // Open work first, most urgent first, then newest — the triage order.
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items, page: buildPageMeta(query, totalItems) };
  },

  findById(propertyId: string, id: string, db: MaintenanceDb = scopedPrisma): Promise<WorkOrderRow | null> {
    return db.maintenanceWorkOrder.findFirst({ where: { id, propertyId }, include: workOrderInclude });
  },

  /** A room scoped to the property — validates a work order's target/OOS room. */
  findRoom(
    propertyId: string,
    roomId: string,
    db: MaintenanceDb = scopedPrisma,
  ): Promise<{ id: string; name: string; status: string } | null> {
    return db.room.findFirst({ where: { id: roomId, propertyId }, select: { id: true, name: true, status: true } });
  },

  /** Confirms a staff member belongs to the caller's organization (scoped). */
  findStaff(userId: string, db: MaintenanceDb = scopedPrisma): Promise<{ id: string } | null> {
    return db.user.findFirst({ where: { id: userId }, select: { id: true } });
  },

  create(
    propertyId: string,
    data: Prisma.MaintenanceWorkOrderUncheckedCreateInput,
    db: MaintenanceDb = scopedPrisma,
  ): Promise<WorkOrderRow> {
    return db.maintenanceWorkOrder.create({ data: { ...data, propertyId }, include: workOrderInclude });
  },

  async update(
    propertyId: string,
    id: string,
    data: Prisma.MaintenanceWorkOrderUpdateInput,
    db: MaintenanceDb = scopedPrisma,
  ): Promise<WorkOrderRow> {
    await db.maintenanceWorkOrder.update({ where: { id, propertyId }, data });
    const row = await this.findById(propertyId, id, db);
    if (!row) throw new NotFoundError('Work order not found.');
    return row;
  },

  setRoomStatus(
    propertyId: string,
    roomId: string,
    status: 'ACTIVE' | 'MAINTENANCE',
    db: MaintenanceDb = scopedPrisma,
  ): Promise<{ id: string }> {
    return db.room.update({ where: { id: roomId, propertyId }, data: { status }, select: { id: true } });
  },
};

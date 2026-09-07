import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { maintenanceRepository, type MaintenanceDb, type WorkOrderRow } from './repository.js';
import type { CreateWorkOrderInput, ListWorkOrdersQuery, UpdateWorkOrderInput } from './schemas.js';

/** The wire shape of a work order — dates serialized, room/assignee embedded. */
export interface WorkOrderView {
  id: string;
  propertyId: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  takesRoomOutOfService: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  room: { id: string; name: string; floor: string | null; status: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
}

function serialize(row: WorkOrderRow): WorkOrderView {
  return {
    id: row.id,
    propertyId: row.propertyId,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    takesRoomOutOfService: row.takesRoomOutOfService,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    room: row.room,
    assignedTo: row.assignedTo,
  };
}

/** A resolved or cancelled order is terminal — its lifecycle is over. */
const TERMINAL = new Set(['RESOLVED', 'CANCELLED']);

export async function listWorkOrders(propertyId: string, query: ListWorkOrdersQuery): Promise<{ items: WorkOrderView[]; page: PageMeta }> {
  const { items, page } = await maintenanceRepository.list(propertyId, query);
  return { items: items.map(serialize), page };
}

export async function getWorkOrder(propertyId: string, id: string): Promise<WorkOrderView> {
  const row = await maintenanceRepository.findById(propertyId, id);
  if (!row) {
    throw new NotFoundError('Work order not found.');
  }
  return serialize(row);
}

/**
 * Create a work order. The room (if given) and assignee (if given) are both
 * validated against the caller's tenant inside the transaction — a
 * cross-tenant id is a 404. When `takeRoomOutOfService` is set with a room,
 * the room is flipped to MAINTENANCE (removed from sellable inventory) as part
 * of the same transaction, and `takesRoomOutOfService` is recorded so a later
 * resolve can return it to service.
 */
export async function createWorkOrder(propertyId: string, input: CreateWorkOrderInput): Promise<WorkOrderView> {
  const created = await scopedPrisma.$transaction(async (tx) => {
    const db = tx as unknown as MaintenanceDb;
    await maintenanceRepository.requireProperty(propertyId, db);

    let roomName: string | undefined;
    if (input.roomId) {
      const room = await maintenanceRepository.findRoom(propertyId, input.roomId, db);
      if (!room) {
        throw new NotFoundError('Room not found at this property.');
      }
      roomName = room.name;
    }
    if (input.assignedToId) {
      const staff = await maintenanceRepository.findStaff(input.assignedToId, db);
      if (!staff) {
        throw new NotFoundError('Assigned staff member not found.');
      }
    }

    const takesOut = Boolean(input.takeRoomOutOfService && input.roomId);

    const order = await maintenanceRepository.create(
      propertyId,
      {
        propertyId,
        roomId: input.roomId ?? null,
        title: input.title,
        description: input.description ?? null,
        category: (input.category ?? 'OTHER') as never,
        priority: (input.priority ?? 'MEDIUM') as never,
        assignedToId: input.assignedToId ?? null,
        takesRoomOutOfService: takesOut,
      },
      db,
    );

    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.WORK_ORDER_CREATED,
        entityType: AUDIT_ENTITY_TYPES.WORK_ORDER,
        entityId: order.id,
        metadata: {
          propertyId,
          title: order.title,
          priority: order.priority,
          category: order.category,
          ...(input.roomId ? { roomId: input.roomId } : {}),
        },
      },
      tx,
    );

    if (takesOut && input.roomId) {
      await maintenanceRepository.setRoomStatus(propertyId, input.roomId, 'MAINTENANCE', db);
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.ROOM_OUT_OF_SERVICE,
          entityType: AUDIT_ENTITY_TYPES.ROOM,
          entityId: input.roomId,
          metadata: { name: roomName ?? 'room', workOrderId: order.id, reason: order.title },
        },
        tx,
      );
    }

    return order;
  });

  return getWorkOrder(propertyId, created.id);
}

/**
 * Update a work order — retitle, recategorize, reprioritize, (re)assign, or
 * move it through its lifecycle. Two inventory-affecting transitions are
 * handled here:
 *
 *  - Resolving or cancelling an order that took its room out of service
 *    returns that room to ACTIVE (only if the room is still in MAINTENANCE —
 *    another open order may still hold it, in which case it stays out).
 *  - Toggling `takeRoomOutOfService` on an open order blocks/unblocks its room
 *    without resolving it.
 *
 * A terminal order (RESOLVED/CANCELLED) can only be reopened, not otherwise
 * edited — reopening does NOT automatically re-block the room.
 */
export async function updateWorkOrder(propertyId: string, id: string, input: UpdateWorkOrderInput): Promise<WorkOrderView> {
  const before = await maintenanceRepository.findById(propertyId, id);
  if (!before) {
    throw new NotFoundError('Work order not found.');
  }

  if (TERMINAL.has(before.status)) {
    const reopening = input.status && !TERMINAL.has(input.status);
    if (!reopening) {
      throw new ConflictError(`This work order is ${before.status.toLowerCase()} and cannot be edited. Reopen it first.`);
    }
  }

  const movingToResolved = input.status === 'RESOLVED' && before.status !== 'RESOLVED';
  const movingToTerminal = input.status !== undefined && TERMINAL.has(input.status) && !TERMINAL.has(before.status);

  const updated = await scopedPrisma.$transaction(async (tx) => {
    const db = tx as unknown as MaintenanceDb;

    if (input.assignedToId) {
      const staff = await maintenanceRepository.findStaff(input.assignedToId, db);
      if (!staff) {
        throw new NotFoundError('Assigned staff member not found.');
      }
    }

    // Whether this order will hold its room out of service after the update.
    const willTakeOut =
      input.takeRoomOutOfService !== undefined ? Boolean(input.takeRoomOutOfService && before.roomId) : before.takesRoomOutOfService;

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.category !== undefined) data.category = input.category;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.status !== undefined) data.status = input.status;
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
    if (input.takeRoomOutOfService !== undefined) data.takesRoomOutOfService = willTakeOut;
    if (movingToResolved) data.resolvedAt = new Date();
    // Reopening clears the resolved stamp.
    if (input.status !== undefined && !TERMINAL.has(input.status) && before.status === 'RESOLVED') data.resolvedAt = null;

    // A terminal transition releases the room this order was holding.
    if (movingToTerminal && before.takesRoomOutOfService && before.roomId) {
      data.takesRoomOutOfService = false;
    }

    const order = await maintenanceRepository.update(propertyId, id, data, db);

    // --- Room out-of-service side effects ---
    // Case A: newly taking the room out (open order, toggle turned on).
    if (before.roomId && !before.takesRoomOutOfService && willTakeOut && !movingToTerminal) {
      const room = await maintenanceRepository.findRoom(propertyId, before.roomId, db);
      if (room && room.status !== 'MAINTENANCE') {
        await maintenanceRepository.setRoomStatus(propertyId, before.roomId, 'MAINTENANCE', db);
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.ROOM_OUT_OF_SERVICE,
            entityType: AUDIT_ENTITY_TYPES.ROOM,
            entityId: before.roomId,
            metadata: { name: room.name, workOrderId: id, reason: before.title },
          },
          tx,
        );
      }
    }

    // Case B: this order was holding the room out and is now resolving/
    // cancelling, or its toggle was turned off — return the room to service,
    // but only if no OTHER active order still holds it out.
    const releasing =
      before.roomId &&
      before.takesRoomOutOfService &&
      (movingToTerminal || input.takeRoomOutOfService === false);
    if (releasing && before.roomId) {
      const otherHold = await db.maintenanceWorkOrder.findFirst({
        where: {
          propertyId,
          roomId: before.roomId,
          takesRoomOutOfService: true,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          id: { not: id },
        },
        select: { id: true },
      });
      if (!otherHold) {
        const room = await maintenanceRepository.findRoom(propertyId, before.roomId, db);
        if (room && room.status === 'MAINTENANCE') {
          await maintenanceRepository.setRoomStatus(propertyId, before.roomId, 'ACTIVE', db);
          await recordAuditEvent(
            {
              action: AUDIT_ACTIONS.ROOM_RETURNED_TO_SERVICE,
              entityType: AUDIT_ENTITY_TYPES.ROOM,
              entityId: before.roomId,
              metadata: { name: room.name, workOrderId: id },
            },
            tx,
          );
        }
      }
    }

    await recordAuditEvent(
      {
        action: movingToResolved ? AUDIT_ACTIONS.WORK_ORDER_RESOLVED : AUDIT_ACTIONS.WORK_ORDER_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.WORK_ORDER,
        entityId: id,
        metadata: {
          title: order.title,
          ...(input.status !== undefined ? { status: { from: before.status, to: input.status } } : {}),
          ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId ?? 'unassigned' } : {}),
        },
      },
      tx,
    );

    return order;
  });

  return getWorkOrder(propertyId, updated.id);
}

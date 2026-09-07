import { BadRequestError, ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import {
  housekeepingRepository,
  type BoardReservationRow,
  type BoardRoomRow,
  type HousekeepingDb,
  type HousekeepingTaskRow,
} from './repository.js';
import type { CreateTaskInput, ListTasksQuery, SetConditionInput, UpdateTaskInput } from './schemas.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A room row on the board, with its derived occupancy for the requested date. */
export interface BoardRoomView {
  id: string;
  name: string;
  floor: string | null;
  status: string;
  housekeepingStatus: string;
  roomType: { id: string; name: string; code: string | null };
  /** Occupancy for the board's date: is a guest arriving, departing, staying, or none. */
  occupancy: 'ARRIVAL' | 'DEPARTURE' | 'STAYOVER' | 'VACANT';
  /** Open (PENDING/IN_PROGRESS) housekeeping tasks on this room. */
  openTasks: number;
}

export interface BoardView {
  date: string;
  rooms: BoardRoomView[];
  summary: {
    totalRooms: number;
    dirty: number;
    cleaning: number;
    clean: number;
    inspected: number;
    departures: number;
    arrivals: number;
    stayovers: number;
  };
}

/** The wire shape of a task — dates serialized, room/assignee embedded. */
export interface HousekeepingTaskView {
  id: string;
  type: string;
  status: string;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  room: { id: string; name: string; floor: string | null; roomType: { id: string; name: string; code: string | null } };
  assignedTo: { id: string; firstName: string; lastName: string; email: string } | null;
}

function serializeTask(row: HousekeepingTaskRow): HousekeepingTaskView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    notes: row.notes,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    room: { id: row.room.id, name: row.room.name, floor: row.room.floor, roomType: row.room.roomType },
    assignedTo: row.assignedTo,
  };
}

/**
 * Derives a room's occupancy on one date from the reservations that touch it.
 * A reservation checking out that day is a DEPARTURE (the room to turn over);
 * one checking in that day (and not also a same-day departure of another) is
 * an ARRIVAL; a stay spanning the date on both sides is a STAYOVER. When more
 * than one applies (a same-day turnover), DEPARTURE wins — it's the action
 * housekeeping cares about most.
 */
function deriveOccupancy(roomId: string, date: Date, reservations: BoardReservationRow[]): BoardRoomView['occupancy'] {
  const iso = toIsoDate(date);
  let arrival = false;
  let departure = false;
  let stayover = false;
  for (const r of reservations) {
    if (r.roomId !== roomId) continue;
    const inIso = toIsoDate(r.checkIn);
    const outIso = toIsoDate(r.checkOut);
    if (outIso === iso) departure = true;
    else if (inIso === iso) arrival = true;
    else if (inIso < iso && outIso > iso) stayover = true;
  }
  if (departure) return 'DEPARTURE';
  if (arrival) return 'ARRIVAL';
  if (stayover) return 'STAYOVER';
  return 'VACANT';
}

/**
 * The housekeeping board for a property on a date (default today): every room
 * with both status axes, its derived occupancy, and its open-task count, plus
 * a property-wide summary. Read-only and computed from a bounded set of
 * queries — never one query per room.
 */
export async function getBoard(propertyId: string, dateStr: string | undefined): Promise<BoardView> {
  await housekeepingRepository.requireProperty(propertyId);

  const date = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date(`${toIsoDate(new Date())}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError('date must be a valid YYYY-MM-DD.');
  }

  const [rooms, reservations, openCounts] = await Promise.all([
    housekeepingRepository.listBoardRooms(propertyId),
    housekeepingRepository.boardReservationsOn(propertyId, date),
    housekeepingRepository.openTaskCountsByRoom(propertyId),
  ]);

  const roomViews: BoardRoomView[] = rooms.map((room: BoardRoomRow) => ({
    id: room.id,
    name: room.name,
    floor: room.floor,
    status: room.status,
    housekeepingStatus: room.housekeepingStatus,
    roomType: room.roomType,
    occupancy: deriveOccupancy(room.id, date, reservations),
    openTasks: openCounts.get(room.id) ?? 0,
  }));

  const summary = {
    totalRooms: roomViews.length,
    dirty: roomViews.filter((r) => r.housekeepingStatus === 'DIRTY').length,
    cleaning: roomViews.filter((r) => r.housekeepingStatus === 'CLEANING').length,
    clean: roomViews.filter((r) => r.housekeepingStatus === 'CLEAN').length,
    inspected: roomViews.filter((r) => r.housekeepingStatus === 'INSPECTED').length,
    departures: roomViews.filter((r) => r.occupancy === 'DEPARTURE').length,
    arrivals: roomViews.filter((r) => r.occupancy === 'ARRIVAL').length,
    stayovers: roomViews.filter((r) => r.occupancy === 'STAYOVER').length,
  };

  return { date: toIsoDate(date), rooms: roomViews, summary };
}

/**
 * Set a room's cleaning condition directly (the front-desk/supervisor "mark
 * clean / mark inspected" action). Records an audit entry with the before →
 * after transition; an unchanged submit is a no-op that writes nothing.
 */
export async function setRoomCondition(propertyId: string, roomId: string, input: SetConditionInput): Promise<{ id: string; housekeepingStatus: string }> {
  const room = await housekeepingRepository.findRoom(propertyId, roomId);
  if (!room) {
    throw new NotFoundError('Room not found at this property.');
  }
  if (room.housekeepingStatus === input.housekeepingStatus) {
    // Idempotent no-op — no audit entry for a change that didn't happen.
    return { id: room.id, housekeepingStatus: room.housekeepingStatus };
  }

  await scopedPrisma.$transaction(async (tx) => {
    const scoped = tx as unknown as HousekeepingDb;
    await housekeepingRepository.setRoomCondition(propertyId, roomId, input.housekeepingStatus, scoped);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.ROOM_HOUSEKEEPING_CHANGED,
        entityType: AUDIT_ENTITY_TYPES.ROOM,
        entityId: roomId,
        metadata: { name: room.name, from: room.housekeepingStatus, to: input.housekeepingStatus },
      },
      tx,
    );
  });

  return { id: room.id, housekeepingStatus: input.housekeepingStatus };
}

export async function listTasks(propertyId: string, query: ListTasksQuery): Promise<{ items: HousekeepingTaskView[]; page: PageMeta }> {
  const { items, page } = await housekeepingRepository.listTasks(propertyId, query);
  return { items: items.map(serializeTask), page };
}

export async function getTask(propertyId: string, id: string): Promise<HousekeepingTaskView> {
  const task = await housekeepingRepository.findTaskById(propertyId, id);
  if (!task) {
    throw new NotFoundError('Housekeeping task not found.');
  }
  return serializeTask(task);
}

/**
 * Create a cleaning task on a room. The room must belong to the property, and
 * an assignee (if given) must be a staff member of the caller's organization —
 * both resolved through the scoped client inside the transaction, so a
 * cross-tenant room or user id is a 404, indistinguishable from nonexistent.
 */
export async function createTask(propertyId: string, input: CreateTaskInput): Promise<HousekeepingTaskView> {
  const created = await scopedPrisma.$transaction(async (tx) => {
    const scoped = tx as unknown as HousekeepingDb;
    const room = await housekeepingRepository.findRoom(propertyId, input.roomId, scoped);
    if (!room) {
      throw new NotFoundError('Room not found at this property.');
    }
    if (input.assignedToId) {
      const staff = await housekeepingRepository.findStaff(input.assignedToId, scoped);
      if (!staff) {
        throw new NotFoundError('Assigned staff member not found.');
      }
    }

    const task = await housekeepingRepository.createTask({ ...input, type: input.type ?? 'DEPARTURE' }, scoped);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.HOUSEKEEPING_TASK_CREATED,
        entityType: AUDIT_ENTITY_TYPES.HOUSEKEEPING_TASK,
        entityId: task.id,
        metadata: {
          roomId: room.id,
          roomName: room.name,
          type: task.type,
          ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
        },
      },
      tx,
    );
    return task;
  });

  return serializeTask(created);
}

/** Statuses a task can no longer be edited out of — terminal states. */
const TERMINAL = new Set(['DONE', 'CANCELLED']);

/**
 * Update a task — move it through its lifecycle, (re)assign it, edit notes/type.
 * Moving to DONE stamps `completedAt` and audits a completion; moving away from
 * DONE clears it. A task already in a terminal state (DONE/CANCELLED) cannot be
 * edited except to reopen it back to PENDING/IN_PROGRESS.
 */
export async function updateTask(propertyId: string, id: string, input: UpdateTaskInput): Promise<HousekeepingTaskView> {
  const before = await housekeepingRepository.findTaskById(propertyId, id);
  if (!before) {
    throw new NotFoundError('Housekeeping task not found.');
  }

  // A terminal task may only be reopened (status back to an active state);
  // editing its notes/assignee/type while closed is a conflict.
  if (TERMINAL.has(before.status)) {
    const reopening = input.status && !TERMINAL.has(input.status);
    if (!reopening) {
      throw new ConflictError(`This task is ${before.status.toLowerCase()} and cannot be edited. Reopen it first.`);
    }
  }

  const movingToDone = input.status === 'DONE' && before.status !== 'DONE';
  const leavingDone = input.status !== undefined && input.status !== 'DONE' && before.status === 'DONE';

  const updated = await scopedPrisma.$transaction(async (tx) => {
    const scoped = tx as unknown as HousekeepingDb;

    if (input.assignedToId) {
      const staff = await housekeepingRepository.findStaff(input.assignedToId, scoped);
      if (!staff) {
        throw new NotFoundError('Assigned staff member not found.');
      }
    }

    const data: Record<string, unknown> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.type !== undefined) data.type = input.type;
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
    if (input.notes !== undefined) data.notes = input.notes;
    if (movingToDone) data.completedAt = new Date();
    if (leavingDone) data.completedAt = null;

    const task = await housekeepingRepository.updateTask(propertyId, id, data, scoped);

    await recordAuditEvent(
      {
        action: movingToDone ? AUDIT_ACTIONS.HOUSEKEEPING_TASK_COMPLETED : AUDIT_ACTIONS.HOUSEKEEPING_TASK_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.HOUSEKEEPING_TASK,
        entityId: id,
        metadata: {
          roomName: before.room.name,
          ...(input.status !== undefined ? { status: { from: before.status, to: input.status } } : {}),
          ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId ?? 'unassigned' } : {}),
        },
      },
      tx,
    );
    return task;
  });

  return serializeTask(updated);
}

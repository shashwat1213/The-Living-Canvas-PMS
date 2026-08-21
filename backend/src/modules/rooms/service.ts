import type { Room } from '@prisma/client';

import { BadRequestError, ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { roomsRepository, type CreateRoomData, type RoomsDb } from './repository.js';
import type { CreateRoomInput, ListRoomsQuery, UpdateRoomInput } from './schemas.js';

export function listRooms(propertyId: string, query: ListRoomsQuery): Promise<{ items: Room[]; page: PageMeta }> {
  return roomsRepository.list(propertyId, query);
}

/** See `properties/service.ts` — same JSON-scalar constraint. */
type FieldChange = { from: string | number | boolean | null; to: string | number | boolean | null };

/**
 * The fields that actually moved. Same reasoning as the property diff:
 * comparing persisted before/after means re-submitting an unchanged
 * value doesn't produce an entry claiming a change.
 */
function diffRoom(before: Room, after: Room): Record<string, FieldChange> {
  const tracked = ['name', 'roomType', 'roomTypeId', 'floor', 'capacity', 'status', 'notes'] as const;
  const changed: Record<string, FieldChange> = {};
  for (const field of tracked) {
    if (before[field] !== after[field]) {
      changed[field] = { from: before[field], to: after[field] };
    }
  }
  return changed;
}

export async function getRoom(propertyId: string, id: string): Promise<Room> {
  const room = await roomsRepository.findById(propertyId, id);
  if (!room) {
    throw new NotFoundError('Room not found.');
  }
  return room;
}

/**
 * Resolves a supplied `roomTypeId` against the room's own property.
 *
 * This is the whole tenant/property guarantee for the link, and it is
 * deliberately a *scoped* read filtered by `propertyId`: a type from
 * another organization resolves to nothing because the scoping extension
 * reaches RoomType through its property, and a type from another property
 * in the same organization resolves to nothing because of the explicit
 * filter. Both surface as the same 404 — the caller learns only that this
 * property has no such type, which is the rule the rest of the API
 * follows.
 *
 * Runs inside the caller's transaction so the type cannot be deleted
 * between the check and the write.
 */
async function resolveRoomTypeName(propertyId: string, roomTypeId: string, db: RoomsDb): Promise<string> {
  const roomType = await db.roomType.findFirst({ where: { id: roomTypeId, propertyId } });
  if (!roomType) {
    throw new NotFoundError('Room type not found at this property.');
  }
  return roomType.name;
}

/**
 * Keeps the two representations of a room's category in step.
 *
 * When a caller supplies `roomTypeId` without a `roomType` label, the
 * label is filled in from the type's name. Without this the legacy column
 * would drift away from the relation the moment a client stopped sending
 * it — and that column is still what the rooms list searches and what the
 * audit trail records, so a stale value there is a real bug, not a
 * cosmetic one. An explicitly supplied `roomType` is never overwritten:
 * the caller said what they meant.
 */
async function resolveCreateInput(propertyId: string, input: CreateRoomInput, db: RoomsDb): Promise<CreateRoomData> {
  if (typeof input.roomTypeId === 'string') {
    const name = await resolveRoomTypeName(propertyId, input.roomTypeId, db);
    return { ...input, roomType: input.roomType ?? name };
  }

  // `createRoomSchema` already refuses a body with neither field, so this
  // is unreachable over HTTP. It is still checked rather than cast,
  // because services are the boundary an AI agent calls directly (see
  // CLAUDE.md) and a cast would turn that into a NOT NULL violation.
  if (input.roomType === undefined) {
    throw new BadRequestError('Provide either roomType or roomTypeId.');
  }
  return { ...input, roomType: input.roomType };
}

/** Same rule for updates, where neither field is required. */
async function resolveUpdateInput(propertyId: string, input: UpdateRoomInput, db: RoomsDb): Promise<UpdateRoomInput> {
  if (typeof input.roomTypeId !== 'string') {
    return input;
  }
  const name = await resolveRoomTypeName(propertyId, input.roomTypeId, db);
  return input.roomType === undefined ? { ...input, roomType: name } : input;
}

// See properties/service.ts for why creates/updates check for an
// existing name proactively rather than relying solely on catching the
// database's unique-constraint error.
export async function createRoom(propertyId: string, input: CreateRoomInput): Promise<Room> {
  const existing = await roomsRepository.findByName(propertyId, input.name);
  if (existing) {
    throw new ConflictError('A room with that name already exists at this property.');
  }
  // Write and audit entry share one transaction, on the scoped client so
  // tenancy is still injected inside it.
  return withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const room = await roomsRepository.create(propertyId, await resolveCreateInput(propertyId, input, tx), tx);
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.ROOM_CREATED,
            entityType: AUDIT_ENTITY_TYPES.ROOM,
            entityId: room.id,
            metadata: { propertyId, name: room.name, roomType: room.roomType },
          },
          tx,
        );
        return room;
      }),
    'A room with that name already exists at this property.',
  );
}

export async function updateRoom(propertyId: string, id: string, input: UpdateRoomInput): Promise<Room> {
  if (input.name) {
    const existing = await roomsRepository.findByName(propertyId, input.name);
    if (existing && existing.id !== id) {
      throw new ConflictError('A room with that name already exists at this property.');
    }
  }
  const before = await getRoom(propertyId, id);

  return withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const resolved = await resolveUpdateInput(propertyId, input, tx);
        const room = await roomsRepository.update(propertyId, id, resolved, tx);

        const changed = diffRoom(before, room);
        if (Object.keys(changed).length > 0) {
          await recordAuditEvent(
            {
              action: AUDIT_ACTIONS.ROOM_UPDATED,
              entityType: AUDIT_ENTITY_TYPES.ROOM,
              entityId: room.id,
              metadata: { propertyId, name: room.name, changed },
            },
            tx,
          );
        }
        return room;
      }),
    'A room with that name already exists at this property.',
  );
}

export async function deleteRoom(propertyId: string, id: string): Promise<void> {
  // Captured before the row is gone, so the entry can name what was
  // removed rather than only its ID.
  const room = await getRoom(propertyId, id);

  await scopedPrisma.$transaction(async (tx) => {
    await roomsRepository.remove(propertyId, id, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.ROOM_DELETED,
        entityType: AUDIT_ENTITY_TYPES.ROOM,
        entityId: id,
        metadata: { propertyId, name: room.name, roomType: room.roomType },
      },
      tx,
    );
  });
}

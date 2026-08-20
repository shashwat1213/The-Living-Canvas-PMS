import type { Room } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { roomsRepository } from './repository.js';
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
  const tracked = ['name', 'roomType', 'floor', 'capacity', 'status', 'notes'] as const;
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
        const room = await roomsRepository.create(propertyId, input, tx);
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
        const room = await roomsRepository.update(propertyId, id, input, tx);

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

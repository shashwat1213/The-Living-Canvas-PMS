import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { roomsRepository, type RoomsDb, type RoomWithType } from './repository.js';
import type { CreateRoomInput, ListRoomsQuery, UpdateRoomInput } from './schemas.js';

const DUPLICATE_NAME = 'A room with that name already exists at this property.';

export function listRooms(propertyId: string, query: ListRoomsQuery): Promise<{ items: RoomWithType[]; page: PageMeta }> {
  return roomsRepository.list(propertyId, query);
}

/** See `properties/service.ts` — same JSON-scalar constraint. */
type FieldChange = { from: string | number | boolean | null; to: string | number | boolean | null };

/**
 * The fields that actually moved. Same reasoning as the property diff:
 * comparing persisted before/after means re-submitting an unchanged value
 * doesn't produce an entry claiming a change.
 *
 * The room's category is audited by its type id and name — the name is
 * captured so a later rename of the type doesn't rewrite history.
 */
function diffRoom(before: RoomWithType, after: RoomWithType): Record<string, FieldChange> {
  const changed: Record<string, FieldChange> = {};

  const scalar = ['name', 'floor', 'capacity', 'status', 'notes'] as const;
  for (const field of scalar) {
    if (before[field] !== after[field]) {
      changed[field] = { from: before[field], to: after[field] };
    }
  }
  if (before.roomTypeId !== after.roomTypeId) {
    changed.roomTypeId = { from: before.roomTypeId, to: after.roomTypeId };
    changed.roomType = { from: before.roomType.name, to: after.roomType.name };
  }

  return changed;
}

export async function getRoom(propertyId: string, id: string): Promise<RoomWithType> {
  const room = await roomsRepository.findById(propertyId, id);
  if (!room) {
    throw new NotFoundError('Room not found.');
  }
  return room;
}

/**
 * Confirms a `roomTypeId` names a type at the room's OWN property, inside
 * the caller's transaction so it cannot be deleted between the check and
 * the write.
 *
 * Deliberately a *scoped* read filtered by `propertyId`: a type from
 * another organization resolves to nothing because the scoping extension
 * reaches RoomType through its property, and a type from another property
 * in the same organization resolves to nothing because of the explicit
 * filter. Both surface as the same 404 — the caller learns only that this
 * property has no such type, which is the rule the rest of the API follows.
 *
 * The database FK would also reject a bad id, but only with a generic
 * constraint error that can't tell "wrong tenant" from "wrong property";
 * this makes the boundary explicit and the 404 precise.
 */
async function assertTypeAtProperty(propertyId: string, roomTypeId: string, db: RoomsDb): Promise<void> {
  const roomType = await db.roomType.findFirst({ where: { id: roomTypeId, propertyId } });
  if (!roomType) {
    throw new NotFoundError('Room type not found at this property.');
  }
}

// See properties/service.ts for why creates/updates check for an existing
// name proactively rather than relying solely on catching the database's
// unique-constraint error.
export async function createRoom(propertyId: string, input: CreateRoomInput): Promise<RoomWithType> {
  const existing = await roomsRepository.findByName(propertyId, input.name);
  if (existing) {
    throw new ConflictError(DUPLICATE_NAME);
  }
  // Write and audit entry share one transaction, on the scoped client so
  // tenancy is still injected inside it.
  return withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        await assertTypeAtProperty(propertyId, input.roomTypeId, tx);
        const room = await roomsRepository.create(propertyId, input, tx);
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.ROOM_CREATED,
            entityType: AUDIT_ENTITY_TYPES.ROOM,
            entityId: room.id,
            metadata: { propertyId, name: room.name, roomTypeId: room.roomTypeId, roomType: room.roomType.name },
          },
          tx,
        );
        return room;
      }),
    DUPLICATE_NAME,
  );
}

export async function updateRoom(propertyId: string, id: string, input: UpdateRoomInput): Promise<RoomWithType> {
  if (input.name) {
    const existing = await roomsRepository.findByName(propertyId, input.name);
    if (existing && existing.id !== id) {
      throw new ConflictError(DUPLICATE_NAME);
    }
  }
  const before = await getRoom(propertyId, id);

  return withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        if (typeof input.roomTypeId === 'string' && input.roomTypeId !== before.roomTypeId) {
          await assertTypeAtProperty(propertyId, input.roomTypeId, tx);
        }
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
    DUPLICATE_NAME,
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
        metadata: { propertyId, name: room.name, roomTypeId: room.roomTypeId, roomType: room.roomType.name },
      },
      tx,
    );
  });
}

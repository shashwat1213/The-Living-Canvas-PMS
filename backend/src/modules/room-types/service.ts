import type { RoomType } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { roomTypesRepository, type RoomTypeWithUsage } from './repository.js';
import type { CreateRoomTypeInput, ListRoomTypesQuery, UpdateRoomTypeInput } from './schemas.js';

const NAME_TAKEN = 'A room type with that name already exists at this property.';
const CODE_TAKEN = 'A room type with that code already exists at this property.';

export function listRoomTypes(
  propertyId: string,
  query: ListRoomTypesQuery,
): Promise<{ items: RoomTypeWithUsage[]; page: PageMeta }> {
  return roomTypesRepository.list(propertyId, query);
}

export async function getRoomType(propertyId: string, id: string): Promise<RoomTypeWithUsage> {
  const roomType = await roomTypesRepository.findById(propertyId, id);
  if (!roomType) {
    throw new NotFoundError('Room type not found.');
  }
  return roomType;
}

/** See `properties/service.ts` — same JSON-scalar constraint. */
type FieldChange = { from: string | number | boolean | null; to: string | number | boolean | null };

function diffRoomType(before: RoomType, after: RoomType): Record<string, FieldChange> {
  const tracked = ['name', 'code', 'description', 'isActive'] as const;
  const changed: Record<string, FieldChange> = {};
  for (const field of tracked) {
    if (before[field] !== after[field]) {
      changed[field] = { from: before[field], to: after[field] };
    }
  }
  return changed;
}

/**
 * Both uniqueness checks run proactively rather than relying solely on
 * catching the database's error, for the reason recorded in
 * `properties/service.ts`. `withUniqueConstraintGuard` still wraps the
 * write as the backstop for the race between check and insert — but it
 * cannot tell which of the two constraints fired, which is why the
 * proactive checks are what produce the specific message.
 */
async function assertNameAndCodeFree(
  propertyId: string,
  input: { name?: string; code?: string },
  excludingId?: string,
): Promise<void> {
  if (input.name) {
    const existing = await roomTypesRepository.findByName(propertyId, input.name);
    if (existing && existing.id !== excludingId) {
      throw new ConflictError(NAME_TAKEN);
    }
  }
  if (input.code) {
    const existing = await roomTypesRepository.findByCode(propertyId, input.code);
    if (existing && existing.id !== excludingId) {
      throw new ConflictError(CODE_TAKEN);
    }
  }
}

export async function createRoomType(propertyId: string, input: CreateRoomTypeInput): Promise<RoomTypeWithUsage> {
  await assertNameAndCodeFree(propertyId, input);

  const created = await withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const roomType = await roomTypesRepository.create(propertyId, input, tx);
        await recordAuditEvent(
          {
            action: AUDIT_ACTIONS.ROOM_TYPE_CREATED,
            entityType: AUDIT_ENTITY_TYPES.ROOM_TYPE,
            entityId: roomType.id,
            // `code` is optional, so it is omitted rather than recorded as
            // null — an absent key reads as "no code", a null reads as a
            // value someone cleared.
            metadata: { propertyId, name: roomType.name, ...(roomType.code ? { code: roomType.code } : {}) },
          },
          tx,
        );
        return roomType;
      }),
    NAME_TAKEN,
  );

  return getRoomType(propertyId, created.id);
}

export async function updateRoomType(
  propertyId: string,
  id: string,
  input: UpdateRoomTypeInput,
): Promise<RoomTypeWithUsage> {
  const before = await getRoomType(propertyId, id);
  await assertNameAndCodeFree(propertyId, input, id);

  await withUniqueConstraintGuard(
    () =>
      scopedPrisma.$transaction(async (tx) => {
        const roomType = await roomTypesRepository.update(propertyId, id, input, tx);

        const changed = diffRoomType(before, roomType);
        if (Object.keys(changed).length > 0) {
          await recordAuditEvent(
            {
              action: AUDIT_ACTIONS.ROOM_TYPE_UPDATED,
              entityType: AUDIT_ENTITY_TYPES.ROOM_TYPE,
              entityId: roomType.id,
              metadata: { propertyId, name: roomType.name, changed },
            },
            tx,
          );
        }
        return roomType;
      }),
    NAME_TAKEN,
  );

  return getRoomType(propertyId, id);
}

/**
 * Deletion is refused while any room still points at the type.
 *
 * The database would allow it — the FK is `SET NULL` — but silently
 * un-typing a floor of rooms is exactly the kind of quiet data loss a
 * PMS must not do, and the caller almost always meant "stop selling
 * this", not "detach it from 40 rooms". The 409 says so and names the
 * count, and `isActive: false` is the operation they wanted: it retires
 * the type for future use while every existing room keeps its
 * classification and history.
 *
 * Same shape as staff offboarding, which refuses a hard delete and
 * deactivates instead.
 */
export async function deleteRoomType(propertyId: string, id: string): Promise<void> {
  const roomType = await getRoomType(propertyId, id);

  if (roomType.roomCount > 0) {
    throw new ConflictError(
      `This room type is still assigned to ${roomType.roomCount} room${roomType.roomCount === 1 ? '' : 's'}. ` +
        'Reassign those rooms first, or set it inactive to retire it instead.',
    );
  }

  await scopedPrisma.$transaction(async (tx) => {
    await roomTypesRepository.remove(propertyId, id, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.ROOM_TYPE_DELETED,
        entityType: AUDIT_ENTITY_TYPES.ROOM_TYPE,
        entityId: id,
        metadata: { propertyId, name: roomType.name, ...(roomType.code ? { code: roomType.code } : {}) },
      },
      tx,
    );
  });
}

import type { Guest } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { guestsRepository, type GuestWithUsage } from './repository.js';
import type { CreateGuestInput, ListGuestsQuery, UpdateGuestInput } from './schemas.js';

export function listGuests(query: ListGuestsQuery): Promise<{ items: GuestWithUsage[]; page: PageMeta }> {
  return guestsRepository.list(query);
}

export async function getGuest(id: string): Promise<GuestWithUsage> {
  const guest = await guestsRepository.findById(id);
  if (!guest) {
    throw new NotFoundError('Guest not found.');
  }
  return guest;
}

function fullName(guest: { firstName: string; lastName: string }): string {
  return `${guest.firstName} ${guest.lastName}`.trim();
}

type FieldChange = { from: string | null; to: string | null };

function diffGuest(before: Guest, after: Guest): Record<string, FieldChange> {
  const tracked = ['firstName', 'lastName', 'email', 'phone', 'notes'] as const;
  const changed: Record<string, FieldChange> = {};
  for (const field of tracked) {
    if (before[field] !== after[field]) {
      changed[field] = { from: before[field], to: after[field] };
    }
  }
  return changed;
}

export async function createGuest(input: CreateGuestInput): Promise<GuestWithUsage> {
  const created = await scopedPrisma.$transaction(async (tx) => {
    const guest = await guestsRepository.create(input, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.GUEST_CREATED,
        entityType: AUDIT_ENTITY_TYPES.GUEST,
        entityId: guest.id,
        // Contact details are not copied into the audit metadata: an audit
        // row is widely readable within an org, and a guest's email/phone is
        // personal data that doesn't need a second home there. The name and
        // the fact of creation are enough to tell the story.
        metadata: { name: fullName(guest) },
      },
      tx,
    );
    return guest;
  });

  return getGuest(created.id);
}

export async function updateGuest(id: string, input: UpdateGuestInput): Promise<GuestWithUsage> {
  const before = await getGuest(id);

  await scopedPrisma.$transaction(async (tx) => {
    const guest = await guestsRepository.update(id, input, tx);
    const changed = diffGuest(before, guest);
    if (Object.keys(changed).length > 0) {
      // Which fields changed is recorded, but not the personal values
      // themselves — the metadata says "phone changed", not what to or from.
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.GUEST_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.GUEST,
          entityId: guest.id,
          metadata: { name: fullName(guest), fieldsChanged: Object.keys(changed) },
        },
        tx,
      );
    }
    return guest;
  });

  return getGuest(id);
}

/**
 * A guest with reservations cannot be deleted — the FK is RESTRICT, so the
 * database would refuse it anyway, but the service returns a clear 409 first
 * rather than surfacing a raw constraint error. Their booking history is part
 * of the property's records; the guest profile stays as long as a reservation
 * references it.
 */
export async function deleteGuest(id: string): Promise<void> {
  const guest = await getGuest(id);

  if (guest.reservationCount > 0) {
    throw new ConflictError(
      `${fullName(guest)} has ${guest.reservationCount} reservation${guest.reservationCount === 1 ? '' : 's'} ` +
        'and cannot be deleted. Their booking history keeps the profile.',
    );
  }

  await scopedPrisma.$transaction(async (tx) => {
    await guestsRepository.remove(id, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.GUEST_DELETED,
        entityType: AUDIT_ENTITY_TYPES.GUEST,
        entityId: id,
        metadata: { name: fullName(guest) },
      },
      tx,
    );
  });
}

/**
 * Guests that already exist with the given email, for a soft duplicate
 * warning at the UI. Not an error and not enforced — two separate walk-ins
 * can legitimately share an email — so this is advisory only.
 */
export function findPossibleDuplicates(email: string): Promise<Guest[]> {
  return guestsRepository.findByEmail(email);
}

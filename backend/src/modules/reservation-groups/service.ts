import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { bookOneInTx, cancelReservation } from '../reservations/service.js';
import { reservationGroupsRepository } from './repository.js';
import type { CancelReservationGroupInput, CreateReservationGroupInput } from './schemas.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A short, human block reference — "BLK-7F3A2C". Collisions are retried. */
function generateReference(): string {
  return `BLK-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/**
 * Create a block: a named group plus its rooms, all-or-nothing.
 *
 * One Serializable transaction: the group header is written, then each room is
 * booked through the shared `bookOneInTx` core (same pricing, availability and
 * confirmation as a standalone booking) carrying this block's id. Availability
 * is checked against the running per-type tally so a block can't oversell
 * against its own earlier rooms — if any room can't be priced or placed the
 * whole transaction rolls back and no block or booking is created. The block's
 * contact guest, if given, must belong to the caller's org (validated via the
 * scoped client). One audit entry records the block; each child booking audits
 * itself as an ordinary reservation.
 */
export async function createReservationGroup(propertyId: string, input: CreateReservationGroupInput) {
  await reservationGroupsRepository.assertPropertyVisible(propertyId);

  if (input.contactGuestId) {
    const contact = await scopedPrisma.guest.findFirst({ where: { id: input.contactGuestId } });
    if (!contact) {
      throw new NotFoundError('Contact guest not found.');
    }
  }

  const created = await scopedPrisma.$transaction(
    async (tx) => {
      let reference = generateReference();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await tx.reservationGroup.findFirst({ where: { propertyId, reference }, select: { id: true } });
        if (!clash) break;
        reference = generateReference();
      }

      const group = await tx.reservationGroup.create({
        data: {
          propertyId,
          name: input.name,
          reference,
          contactGuestId: input.contactGuestId,
          notes: input.notes,
        },
      });

      // Book each room under this block. Each is written before the next, so
      // the shared availability check sees the block's earlier rooms and won't
      // oversell the type.
      for (const room of input.rooms) {
        await bookOneInTx(tx, propertyId, room, { groupId: group.id });
      }

      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.RESERVATION_GROUP_CREATED,
          entityType: AUDIT_ENTITY_TYPES.RESERVATION_GROUP,
          entityId: group.id,
          metadata: { reference, name: input.name, rooms: input.rooms.length },
        },
        tx,
      );

      return group;
    },
    { isolationLevel: 'Serializable' },
  );

  return getReservationGroup(propertyId, created.id);
}

/** A block with its child bookings. 404 if it isn't at this property. */
export async function getReservationGroup(propertyId: string, id: string) {
  const group = await reservationGroupsRepository.findById(propertyId, id);
  if (!group) {
    throw new NotFoundError('Block not found.');
  }
  return serializeGroup(group);
}

/** Every block at a property, newest first. */
export async function listReservationGroups(propertyId: string) {
  await reservationGroupsRepository.assertPropertyVisible(propertyId);
  const groups = await reservationGroupsRepository.list(propertyId);
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    reference: g.reference,
    notes: g.notes,
    createdAt: g.createdAt.toISOString(),
    roomCount: g._count.reservations,
    contactGuest: g.contactGuest,
  }));
}

/**
 * Cancel a whole block: cancel every one of its still-cancellable child
 * bookings, then record the block cancellation. Reuses the per-booking cancel
 * (which frees inventory and audits each one); bookings already checked
 * out / cancelled / no-show are left as they are. The block header itself is
 * kept as a record, so the history of the party stays intact.
 */
export async function cancelReservationGroup(propertyId: string, id: string, input: CancelReservationGroupInput) {
  const group = await reservationGroupsRepository.findById(propertyId, id);
  if (!group) {
    throw new NotFoundError('Block not found.');
  }

  const cancellable = group.reservations.filter((r) => r.status === 'CONFIRMED' || r.status === 'CHECKED_IN');
  if (cancellable.length === 0) {
    throw new ConflictError('This block has no active bookings to cancel.');
  }

  for (const reservation of cancellable) {
    await cancelReservation(propertyId, reservation.id, { reason: input.reason ?? `Block ${group.reference} cancelled.` });
  }

  await recordAuditEvent({
    action: AUDIT_ACTIONS.RESERVATION_GROUP_CANCELLED,
    entityType: AUDIT_ENTITY_TYPES.RESERVATION_GROUP,
    entityId: group.id,
    metadata: { reference: group.reference, cancelled: cancellable.length, ...(input.reason ? { reason: input.reason } : {}) },
  });

  return getReservationGroup(propertyId, id);
}

type GroupRow = NonNullable<Awaited<ReturnType<typeof reservationGroupsRepository.findById>>>;

/** Date-only serialization for the child bookings' stay dates. */
function serializeGroup(group: GroupRow) {
  return {
    id: group.id,
    name: group.name,
    reference: group.reference,
    notes: group.notes,
    createdAt: group.createdAt.toISOString(),
    contactGuest: group.contactGuest,
    totalAmountMinor: group.reservations.reduce((sum, r) => sum + r.totalAmountMinor, 0),
    reservations: group.reservations.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      guest: r.guest,
      roomType: r.roomType,
      room: r.room,
      checkIn: toIsoDate(r.checkIn),
      checkOut: toIsoDate(r.checkOut),
      totalAmountMinor: r.totalAmountMinor,
    })),
  };
}

import { randomUUID } from 'node:crypto';

import type { Reservation } from '@prisma/client';

import { BadRequestError, ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import {
  reservationsRepository,
  type ReservationDetail,
  type ReservationListRow,
  type ReservationsDb,
} from './repository.js';
import type { CancelReservationInput, CreateReservationInput, ListReservationsQuery } from './schemas.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The wire shape of a reservation. Date-only columns (`checkIn`, `checkOut`,
 * each night's `date`) are serialized to `YYYY-MM-DD` rather than left as full
 * ISO timestamps: they are calendar dates, not instants, and a client that
 * receives "2026-10-10T00:00:00.000Z" has to strip the time back off every
 * time. Money and everything else pass through unchanged.
 */
export interface ReservationListView extends Omit<ReservationListRow, 'checkIn' | 'checkOut'> {
  checkIn: string;
  checkOut: string;
}
export interface ReservationView extends Omit<ReservationDetail, 'checkIn' | 'checkOut' | 'nights'> {
  checkIn: string;
  checkOut: string;
  nights: { date: string; amountMinor: number }[];
}

function serializeListRow(row: ReservationListRow): ReservationListView {
  return { ...row, checkIn: toIsoDate(row.checkIn), checkOut: toIsoDate(row.checkOut) };
}

function serializeDetail(row: ReservationDetail): ReservationView {
  return {
    ...row,
    checkIn: toIsoDate(row.checkIn),
    checkOut: toIsoDate(row.checkOut),
    nights: row.nights.map((n) => ({ date: toIsoDate(n.date), amountMinor: n.amountMinor })),
  };
}

/** Every stay night in [checkIn, checkOut) — checkOut is exclusive. */
function nightsBetween(checkIn: Date, checkOut: Date): Date[] {
  const nights: Date[] = [];
  for (let d = new Date(checkIn); d < checkOut; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(new Date(d));
  }
  return nights;
}

/** A short, human booking reference — "LC-3F9K2A". Collisions are retried. */
function generateReference(): string {
  return `LC-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export async function listReservations(
  propertyId: string,
  query: ListReservationsQuery,
): Promise<{ items: ReservationListView[]; page: PageMeta }> {
  const { items, page } = await reservationsRepository.list(propertyId, query);
  return { items: items.map(serializeListRow), page };
}

export async function getReservation(propertyId: string, id: string): Promise<ReservationView> {
  const reservation = await reservationsRepository.findById(propertyId, id);
  if (!reservation) {
    throw new NotFoundError('Reservation not found.');
  }
  return serializeDetail(reservation);
}

interface PricedNight {
  date: Date;
  amountMinor: number;
}

/**
 * Prices a stay from a rate plan's per-date rates, and confirms every night
 * is priced. A night with no `RatePlanRate` row is not sellable on that plan
 * (see the RatePlanRate model), so a booking that spans one is refused with
 * the specific dates named — never silently priced at zero or with a gap.
 *
 * Reads the rates through the passed client so it runs inside the booking
 * transaction, against the same snapshot the write commits under.
 */
async function priceStay(
  ratePlanId: string,
  nights: Date[],
  db: ReservationsDb,
): Promise<{ pricedNights: PricedNight[]; totalMinor: number }> {
  const rateRows = await db.ratePlanRate.findMany({ where: { ratePlanId, date: { in: nights } } });
  const priceByDate = new Map(rateRows.map((r) => [toIsoDate(r.date), r.amountMinor]));

  const pricedNights: PricedNight[] = [];
  const unpriced: string[] = [];
  let totalMinor = 0;
  for (const date of nights) {
    const iso = toIsoDate(date);
    const amount = priceByDate.get(iso);
    if (amount === undefined) {
      unpriced.push(iso);
      continue;
    }
    pricedNights.push({ date, amountMinor: amount });
    totalMinor += amount;
  }

  if (unpriced.length > 0) {
    throw new BadRequestError(
      `This rate plan has no price set for ${unpriced.length} night${unpriced.length === 1 ? '' : 's'} ` +
        `(${unpriced.join(', ')}). Set rates for the whole stay before booking.`,
    );
  }

  return { pricedNights, totalMinor };
}

/**
 * A pre-booking quote: is this stay available, and what would it cost? Used by
 * the UI to show a price before the guest commits, without writing anything.
 * The same validation the create path runs, minus the write.
 */
export async function quoteReservation(
  propertyId: string,
  input: CreateReservationInput,
): Promise<{ available: boolean; sellableRooms: number; booked: number; nights: number; totalMinor: number; pricedNights: { date: string; amountMinor: number }[] }> {
  await resolveParents(propertyId, input, scopedPrisma);
  const nights = nightsBetween(input.checkIn, input.checkOut);
  const { pricedNights, totalMinor } = await priceStay(input.ratePlanId, nights, scopedPrisma);

  const sellableRooms = await reservationsRepository.countSellableRooms(propertyId, input.roomTypeId);
  const booked = await reservationsRepository.countOverlapping(
    propertyId,
    input.roomTypeId,
    input.checkIn,
    input.checkOut,
  );

  return {
    available: booked < sellableRooms,
    sellableRooms,
    booked,
    nights: nights.length,
    totalMinor,
    pricedNights: pricedNights.map((n) => ({ date: toIsoDate(n.date), amountMinor: n.amountMinor })),
  };
}

/**
 * Confirms the guest, room type and rate plan all belong to this property
 * (and thus the caller's organization, via the scoped client). A reference
 * from another property or organization resolves to nothing and 404s — the
 * same "no such thing here" signal every scoped sub-resource gives. The rate
 * plan must additionally belong to the room type being booked.
 */
async function resolveParents(propertyId: string, input: CreateReservationInput, db: ReservationsDb): Promise<void> {
  const roomType = await db.roomType.findFirst({ where: { id: input.roomTypeId, propertyId } });
  if (!roomType) {
    throw new NotFoundError('Room type not found at this property.');
  }
  const ratePlan = await db.ratePlan.findFirst({ where: { id: input.ratePlanId, roomTypeId: input.roomTypeId } });
  if (!ratePlan) {
    throw new NotFoundError('Rate plan not found for this room type.');
  }
  const guest = await db.guest.findFirst({ where: { id: input.guestId } });
  if (!guest) {
    throw new NotFoundError('Guest not found.');
  }
}

/**
 * Creates a CONFIRMED booking.
 *
 * The whole thing runs in one Serializable transaction: parents are
 * re-resolved, the stay is priced from the rate plan, availability is checked
 * (sellable rooms of the type minus overlapping occupying reservations), and
 * — only if a room remains — the reservation and its per-night price snapshot
 * are written with an audit entry. Serializable isolation is what stops two
 * simultaneous bookings from each seeing the last free room and both taking
 * it: one commits, the other fails to serialize and is retried by the caller
 * or surfaces as a conflict. The price is snapshotted into `nights` here so a
 * later change to the rate calendar never re-prices this booking.
 */
export async function createReservation(propertyId: string, input: CreateReservationInput): Promise<ReservationView> {
  const nights = nightsBetween(input.checkIn, input.checkOut);

  const created = await scopedPrisma.$transaction(
    async (tx) => {
      await resolveParents(propertyId, input, tx);

      const { pricedNights, totalMinor } = await priceStay(input.ratePlanId, nights, tx);

      const sellableRooms = await reservationsRepository.countSellableRooms(propertyId, input.roomTypeId, tx);
      if (sellableRooms === 0) {
        throw new ConflictError('This room type has no sellable rooms, so it cannot be booked.');
      }
      const booked = await reservationsRepository.countOverlapping(
        propertyId,
        input.roomTypeId,
        input.checkIn,
        input.checkOut,
        tx,
      );
      if (booked >= sellableRooms) {
        throw new ConflictError(
          `No availability: all ${sellableRooms} room${sellableRooms === 1 ? '' : 's'} of this type are booked for those dates.`,
        );
      }

      // Reference collisions are astronomically unlikely but cheap to guard.
      let reference = generateReference();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await tx.reservation.findFirst({ where: { propertyId, reference }, select: { id: true } });
        if (!clash) break;
        reference = generateReference();
      }

      const reservation = await tx.reservation.create({
        data: {
          propertyId,
          roomTypeId: input.roomTypeId,
          ratePlanId: input.ratePlanId,
          guestId: input.guestId,
          reference,
          status: 'CONFIRMED',
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          adults: input.adults ?? 1,
          children: input.children ?? 0,
          totalAmountMinor: totalMinor,
          notes: input.notes,
          nights: {
            create: pricedNights.map((n) => ({ date: n.date, amountMinor: n.amountMinor })),
          },
        },
      });

      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.RESERVATION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.RESERVATION,
          entityId: reservation.id,
          metadata: {
            reference,
            roomTypeId: input.roomTypeId,
            checkIn: toIsoDate(input.checkIn),
            checkOut: toIsoDate(input.checkOut),
            nights: nights.length,
            totalAmountMinor: totalMinor,
          },
        },
        tx,
      );

      return reservation;
    },
    { isolationLevel: 'Serializable' },
  );

  return getReservation(propertyId, created.id);
}

/** Statuses a reservation can be actively transitioned out of by this slice. */
const CANCELLABLE = new Set(['CONFIRMED', 'CHECKED_IN']);

async function transitionToInactive(
  propertyId: string,
  id: string,
  next: 'CANCELLED' | 'NO_SHOW',
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  reason: string | undefined,
): Promise<ReservationView> {
  const before = await getReservation(propertyId, id);

  if (before.status === next) {
    // Idempotent-ish: re-cancelling a cancelled booking is a no-op conflict,
    // not a silent success that writes a second audit entry.
    throw new ConflictError(`This reservation is already ${next.toLowerCase().replace('_', '-')}.`);
  }
  if (next === 'NO_SHOW' && before.status !== 'CONFIRMED') {
    throw new ConflictError('Only a confirmed reservation can be marked a no-show.');
  }
  if (next === 'CANCELLED' && !CANCELLABLE.has(before.status)) {
    throw new ConflictError(`A ${before.status.toLowerCase()} reservation cannot be cancelled.`);
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id },
      data: { status: next, cancelledAt: new Date(), cancelReason: reason ?? null },
    });
    await recordAuditEvent(
      {
        action,
        entityType: AUDIT_ENTITY_TYPES.RESERVATION,
        entityId: id,
        metadata: { reference: before.reference, from: before.status, to: next, ...(reason ? { reason } : {}) },
      },
      tx,
    );
  });

  return getReservation(propertyId, id);
}

export function cancelReservation(
  propertyId: string,
  id: string,
  input: CancelReservationInput,
): Promise<ReservationView> {
  return transitionToInactive(propertyId, id, 'CANCELLED', AUDIT_ACTIONS.RESERVATION_CANCELLED, input.reason);
}

export function markNoShow(propertyId: string, id: string): Promise<ReservationView> {
  return transitionToInactive(propertyId, id, 'NO_SHOW', AUDIT_ACTIONS.RESERVATION_NO_SHOW, undefined);
}

export type { Reservation };

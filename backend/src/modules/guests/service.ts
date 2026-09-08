import type { Guest } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { guestsRepository, type GuestsDb, type GuestWithUsage } from './repository.js';
import type { CreateGuestInput, ListGuestsQuery, SetGuestTagsInput, UpdateGuestInput } from './schemas.js';

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

/** Normalises a tag set: upper-cased, trimmed, de-duplicated, order preserved. */
function normaliseTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toUpperCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Replaces a guest's segmentation tags as a set. Records an audit entry with
 * the before/after tag sets (labels are not personal data, so unlike contact
 * fields they are safe to record in full). A no-op set change writes nothing.
 */
export async function setGuestTags(id: string, input: SetGuestTagsInput): Promise<GuestWithUsage> {
  const before = await getGuest(id);
  const next = normaliseTags(input.tags);
  const current = before.tags;

  const unchanged = current.length === next.length && current.every((t, i) => t === next[i]);
  if (unchanged) return before;

  await scopedPrisma.$transaction(async (tx) => {
    await guestsRepository.setTags(id, next, tx as unknown as GuestsDb);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.GUEST_TAGS_CHANGED,
        entityType: AUDIT_ENTITY_TYPES.GUEST,
        entityId: id,
        metadata: { name: fullName(before), from: current, to: next },
      },
      tx,
    );
  });

  return getGuest(id);
}

/** The reservation statuses that represent a stay the guest actually took/holds. */
const REALISED_STATUSES = new Set(['CHECKED_IN', 'CHECKED_OUT']);

/** One line of a guest's stay history. */
export interface GuestStay {
  id: string;
  reference: string;
  status: string;
  property: { id: string; name: string };
  roomType: { id: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  totalAmountMinor: number;
}

export interface GuestProfile {
  guest: GuestWithUsage;
  stats: {
    totalStays: number;
    upcomingStays: number;
    cancelledStays: number;
    nightsStayed: number;
    /** Agreed booking value across non-cancelled reservations, INR paise. */
    bookedValueMinor: number;
    /** Realised charges across all the guest's folios, INR paise. */
    chargedMinor: number;
    /** Payments received across all the guest's folios, INR paise. */
    paidMinor: number;
    /** Outstanding across folios (charged − paid); positive = guest owes. */
    balanceMinor: number;
    /** True once the guest has more than one stay that was actually taken. */
    isRepeatGuest: boolean;
    firstStay: string | null;
    lastStay: string | null;
  };
  stays: GuestStay[];
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}

/**
 * The guest-360 view: the profile plus a computed stay history and lifetime
 * value. Read-only and derived from the guest's reservations and their folios
 * — no stored aggregate to drift out of sync. Booked value counts every
 * non-cancelled reservation's agreed total; charged/paid come from the folios
 * so they reflect what was actually billed and collected (room + POS + extras).
 */
export async function getGuestProfile(id: string): Promise<GuestProfile> {
  const source = await guestsRepository.profileSource(id);
  if (!source) {
    throw new NotFoundError('Guest not found.');
  }

  const stays: GuestStay[] = source.reservations.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    property: r.property,
    roomType: r.roomType,
    checkIn: toIsoDate(r.checkIn),
    checkOut: toIsoDate(r.checkOut),
    nights: nightsBetween(r.checkIn, r.checkOut),
    totalAmountMinor: r.totalAmountMinor,
  }));

  const today = toIsoDate(new Date());
  let upcomingStays = 0;
  let cancelledStays = 0;
  let nightsStayed = 0;
  let bookedValueMinor = 0;
  let chargedMinor = 0;
  let paidMinor = 0;
  let realisedCount = 0;
  let firstStay: string | null = null;
  let lastStay: string | null = null;

  for (const r of source.reservations) {
    const cancelled = r.status === 'CANCELLED' || r.status === 'NO_SHOW';
    if (cancelled) {
      cancelledStays += 1;
    } else {
      bookedValueMinor += r.totalAmountMinor;
      if (toIsoDate(r.checkIn) > today) upcomingStays += 1;
    }
    if (REALISED_STATUSES.has(r.status)) {
      realisedCount += 1;
      nightsStayed += nightsBetween(r.checkIn, r.checkOut);
      const inIso = toIsoDate(r.checkIn);
      if (!firstStay || inIso < firstStay) firstStay = inIso;
      if (!lastStay || inIso > lastStay) lastStay = inIso;
    }
    if (r.folio) {
      chargedMinor += r.folio.charges.reduce((a, c) => a + c.amountMinor, 0);
      paidMinor += r.folio.payments.reduce((a, p) => a + p.amountMinor, 0);
    }
  }

  const guest = await getGuest(id);

  return {
    guest,
    stats: {
      totalStays: source.reservations.length,
      upcomingStays,
      cancelledStays,
      nightsStayed,
      bookedValueMinor,
      chargedMinor,
      paidMinor,
      balanceMinor: chargedMinor - paidMinor,
      isRepeatGuest: realisedCount > 1,
      firstStay,
      lastStay,
    },
    stays,
  };
}

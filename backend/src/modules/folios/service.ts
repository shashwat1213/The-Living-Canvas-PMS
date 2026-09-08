import { BadRequestError, ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { foliosRepository, type FolioWithLines, type FoliosDb } from './repository.js';
import type { AddChargeInput, AddPaymentInput } from './schemas.js';

/** The wire shape of a folio: its lines plus the derived money summary. */
export interface FolioView {
  id: string;
  reservationId: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reservation: {
    id: string;
    reference: string;
    totalAmountMinor: number;
    guest: { id: string; firstName: string; lastName: string };
  };
  charges: { id: string; description: string; amountMinor: number; createdAt: string }[];
  payments: {
    id: string;
    method: string;
    amountMinor: number;
    reference: string | null;
    note: string | null;
    createdAt: string;
  }[];
  /** Derived, never stored: sum of charges. */
  chargesTotalMinor: number;
  /** Derived: sum of payments. */
  paymentsTotalMinor: number;
  /** Derived: charges minus payments. Positive = the guest owes; negative = credit due. */
  balanceMinor: number;
}

function sum(rows: { amountMinor: number }[]): number {
  return rows.reduce((acc, r) => acc + r.amountMinor, 0);
}

/**
 * Serializes a folio and computes its money summary from the line items. The
 * balance is ALWAYS derived here, never read from a stored column, so it cannot
 * drift from the charges and payments that justify it.
 */
function toView(folio: FolioWithLines): FolioView {
  const chargesTotalMinor = sum(folio.charges);
  const paymentsTotalMinor = sum(folio.payments);
  return {
    id: folio.id,
    reservationId: folio.reservationId,
    status: folio.status,
    closedAt: folio.closedAt ? folio.closedAt.toISOString() : null,
    createdAt: folio.createdAt.toISOString(),
    updatedAt: folio.updatedAt.toISOString(),
    reservation: {
      id: folio.reservation.id,
      reference: folio.reservation.reference,
      totalAmountMinor: folio.reservation.totalAmountMinor,
      guest: folio.reservation.guest,
    },
    charges: folio.charges.map((c) => ({
      id: c.id,
      description: c.description,
      amountMinor: c.amountMinor,
      createdAt: c.createdAt.toISOString(),
    })),
    payments: folio.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amountMinor: p.amountMinor,
      reference: p.reference,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
    })),
    chargesTotalMinor,
    paymentsTotalMinor,
    balanceMinor: chargesTotalMinor - paymentsTotalMinor,
  };
}

/**
 * The folio for a reservation, opening one on first access. A folio is the
 * bill for a booking, so it's created lazily the first time someone views it
 * (or posts to it) rather than eagerly at booking time — most of the read
 * paths want "show me the bill", and the bill should exist when asked for.
 *
 * On open, the reservation's agreed total is posted as the initial room
 * charge, so a fresh folio already shows what the stay costs. The whole open
 * (folio row + room charge + audit) commits in one transaction.
 */
export async function getOrOpenFolio(reservationId: string): Promise<FolioView> {
  const existing = await foliosRepository.findByReservation(reservationId);
  if (existing) {
    return toView(existing);
  }

  const reservation = await foliosRepository.findReservationForFolio(reservationId);
  if (!reservation) {
    throw new NotFoundError('Reservation not found.');
  }

  const created = await scopedPrisma.$transaction(async (tx) => {
    // Guard against a race: two concurrent first-views could both try to open.
    // The unique constraint on reservationId is the ultimate backstop; this
    // check keeps the common case clean.
    const raced = await foliosRepository.findByReservation(reservationId, tx as unknown as FoliosDb);
    if (raced) return raced;

    const folio = await tx.folio.create({
      data: {
        reservationId,
        charges: {
          create: {
            description: `Room charge — booking ${reservation.reference}`,
            amountMinor: reservation.totalAmountMinor,
          },
        },
      },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.FOLIO_OPENED,
        entityType: AUDIT_ENTITY_TYPES.FOLIO,
        entityId: folio.id,
        metadata: { reference: reservation.reference, roomChargeMinor: reservation.totalAmountMinor },
      },
      tx,
    );
    return folio;
  });

  return toView(await foliosRepository.requireById(created.id));
}

/** Loads a folio by id (must already exist). */
export async function getFolio(folioId: string): Promise<FolioView> {
  return toView(await foliosRepository.requireById(folioId));
}

/** A closed folio is settled and locked; nothing may be posted to it until reopened. */
function assertOpen(folio: FolioWithLines): void {
  if (folio.status === 'CLOSED') {
    throw new ConflictError('This folio is closed. Reopen it before posting to it.');
  }
}

export async function addCharge(folioId: string, input: AddChargeInput): Promise<FolioView> {
  const folio = await foliosRepository.requireById(folioId);
  assertOpen(folio);

  await scopedPrisma.$transaction(async (tx) => {
    const charge = await tx.folioCharge.create({
      data: { folioId, description: input.description, amountMinor: input.amountMinor },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.FOLIO_CHARGE_ADDED,
        entityType: AUDIT_ENTITY_TYPES.FOLIO,
        entityId: folioId,
        metadata: { reference: folio.reservation.reference, chargeId: charge.id, description: input.description, amountMinor: input.amountMinor },
      },
      tx,
    );
  });

  return toView(await foliosRepository.requireById(folioId));
}

export async function addPayment(folioId: string, input: AddPaymentInput): Promise<FolioView> {
  const folio = await foliosRepository.requireById(folioId);
  assertOpen(folio);

  await scopedPrisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        folioId,
        method: input.method,
        amountMinor: input.amountMinor,
        reference: input.reference ?? null,
        note: input.note ?? null,
      },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.FOLIO_PAYMENT_RECORDED,
        entityType: AUDIT_ENTITY_TYPES.FOLIO,
        entityId: folioId,
        // The amount and method are recorded; the free-text reference is not
        // copied into the audit metadata (it may carry an external id).
        metadata: { reference: folio.reservation.reference, paymentId: payment.id, method: input.method, amountMinor: input.amountMinor },
      },
      tx,
    );
  });

  return toView(await foliosRepository.requireById(folioId));
}

/**
 * Close (settle) a folio. Only a fully-paid folio can be closed — a zero
 * balance — so closing is a deliberate "this bill is settled" action, not a
 * way to hide an outstanding amount. A refund owed (negative balance) also
 * blocks closing.
 */
export async function closeFolio(folioId: string): Promise<FolioView> {
  const folio = await foliosRepository.requireById(folioId);
  if (folio.status === 'CLOSED') {
    throw new ConflictError('This folio is already closed.');
  }
  const balance = sum(folio.charges) - sum(folio.payments);
  if (balance !== 0) {
    throw new BadRequestError(
      balance > 0
        ? 'The folio has an outstanding balance and cannot be closed until it is paid in full.'
        : 'The folio is overpaid; record a refund to bring the balance to zero before closing.',
    );
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.folio.update({ where: { id: folioId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.FOLIO_CLOSED,
        entityType: AUDIT_ENTITY_TYPES.FOLIO,
        entityId: folioId,
        metadata: { reference: folio.reservation.reference },
      },
      tx,
    );
  });

  return toView(await foliosRepository.requireById(folioId));
}

/** Reopen a closed folio so a correction or additional posting can be made. */
export async function reopenFolio(folioId: string): Promise<FolioView> {
  const folio = await foliosRepository.requireById(folioId);
  if (folio.status === 'OPEN') {
    throw new ConflictError('This folio is already open.');
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.folio.update({ where: { id: folioId }, data: { status: 'OPEN', closedAt: null } });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.FOLIO_REOPENED,
        entityType: AUDIT_ENTITY_TYPES.FOLIO,
        entityId: folioId,
        metadata: { reference: folio.reservation.reference },
      },
      tx,
    );
  });

  return toView(await foliosRepository.requireById(folioId));
}

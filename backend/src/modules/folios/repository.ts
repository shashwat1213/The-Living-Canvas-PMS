import type { Prisma } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';

/**
 * A folio always travels with its line items — the charges and payments are
 * what justify its balance, so a bare folio row is never useful on its own.
 * Both are ordered oldest-first, the order a statement reads.
 */
const folioInclude = {
  charges: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  reservation: {
    select: {
      id: true,
      reference: true,
      totalAmountMinor: true,
      guest: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.FolioInclude;

export type FolioWithLines = Prisma.FolioGetPayload<{ include: typeof folioInclude }>;

/** The subset of the scoped client the folio service and its transactions use. */
export type FoliosDb = Pick<typeof scopedPrisma, 'folio' | 'folioCharge' | 'payment' | 'reservation'>;

export const foliosRepository = {
  /**
   * The folio for a reservation, or null if none has been opened yet. Scoped
   * through folio → reservation → property, so a folio under another
   * organization's reservation resolves to nothing.
   */
  findByReservation(reservationId: string, db: FoliosDb = scopedPrisma): Promise<FolioWithLines | null> {
    return db.folio.findFirst({ where: { reservationId }, include: folioInclude });
  },

  findById(folioId: string, db: FoliosDb = scopedPrisma): Promise<FolioWithLines | null> {
    return db.folio.findFirst({ where: { id: folioId }, include: folioInclude });
  },

  /**
   * The reservation a folio will belong to, resolved through the scoped client
   * so a cross-tenant reservation id is invisible. Returns the fields the
   * service needs to open the folio and post the room charge.
   */
  async findReservationForFolio(
    reservationId: string,
    db: FoliosDb = scopedPrisma,
  ): Promise<{ id: string; reference: string; totalAmountMinor: number; status: string } | null> {
    return db.reservation.findFirst({
      where: { id: reservationId },
      select: { id: true, reference: true, totalAmountMinor: true, status: true },
    });
  },

  /** Loads a folio that must exist, or throws a 404. */
  async requireById(folioId: string, db: FoliosDb = scopedPrisma): Promise<FolioWithLines> {
    const folio = await this.findById(folioId, db);
    if (!folio) {
      throw new NotFoundError('Folio not found.');
    }
    return folio;
  },
};

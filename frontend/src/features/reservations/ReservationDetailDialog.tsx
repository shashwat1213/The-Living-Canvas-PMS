import { useEffect, useState } from 'react';

import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { formatMinor } from '../rate-plans/money';
import { getReservation } from './api';
import {
  RESERVATION_STATUS_LABEL,
  nightCount,
  reservationGuestName,
  type Reservation,
  type ReservationStatus,
} from './types';

interface ReservationDetailDialogProps {
  propertyId: string;
  reservationId: string;
  onClose: () => void;
}

const STATUS_TONE: Record<ReservationStatus, 'positive' | 'accent' | 'neutral' | 'muted'> = {
  CONFIRMED: 'positive',
  CHECKED_IN: 'accent',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'muted',
  NO_SHOW: 'muted',
};

/**
 * Read-only detail for one reservation, including the per-night price snapshot
 * taken at booking time — so the total is always explained, not just asserted.
 * The nights are what the booking was priced at; a later change to the rate
 * calendar never re-prices them, and this view shows exactly that record.
 */
export function ReservationDetailDialog({ propertyId, reservationId, onClose }: ReservationDetailDialogProps) {
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getReservation(propertyId, reservationId)
      .then((res) => {
        if (active) setReservation(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load this reservation.');
      });
    return () => {
      active = false;
    };
  }, [propertyId, reservationId]);

  const title = reservation ? `Booking ${reservation.reference}` : 'Booking';

  return (
    <Modal title={title} size="wide" onClose={onClose}>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {!reservation && !error && <p className="reservation-detail-loading">Loading…</p>}

      {reservation && (
        <div className="reservation-detail">
          <div className="reservation-detail-status">
            <Badge tone={STATUS_TONE[reservation.status]}>{RESERVATION_STATUS_LABEL[reservation.status]}</Badge>
            {reservation.status === 'CANCELLED' && reservation.cancelReason && (
              <span className="reservation-muted">Reason: {reservation.cancelReason}</span>
            )}
          </div>

          <dl className="reservation-facts">
            <div>
              <dt>Guest</dt>
              <dd>
                {reservationGuestName(reservation.guest)}
                {reservation.guest.email && <span className="reservation-muted"> · {reservation.guest.email}</span>}
                {reservation.guest.phone && <span className="reservation-muted"> · {reservation.guest.phone}</span>}
              </dd>
            </div>
            <div>
              <dt>Room type</dt>
              <dd>
                {reservation.roomType.name}
                {reservation.roomType.code ? ` (${reservation.roomType.code})` : ''}
              </dd>
            </div>
            <div>
              <dt>Rate plan</dt>
              <dd>
                {reservation.ratePlan.name}
                <span className="reservation-muted">
                  {' · '}
                  {reservation.ratePlan.isRefundable ? 'Refundable' : 'Non-refundable'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Stay</dt>
              <dd>
                {reservation.checkIn} → {reservation.checkOut}
                <span className="reservation-muted">
                  {' · '}
                  {nightCount(reservation.checkIn, reservation.checkOut)} night
                  {nightCount(reservation.checkIn, reservation.checkOut) === 1 ? '' : 's'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Guests</dt>
              <dd>
                {reservation.adults} adult{reservation.adults === 1 ? '' : 's'}
                {reservation.children > 0 && `, ${reservation.children} child${reservation.children === 1 ? '' : 'ren'}`}
              </dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>{reservation.room ? reservation.room.name : <span className="reservation-muted">Not assigned</span>}</dd>
            </div>
          </dl>

          {reservation.notes && (
            <div className="reservation-detail-notes">
              <dt>Notes</dt>
              <dd>{reservation.notes}</dd>
            </div>
          )}

          <div className="reservation-nights">
            <h3>Price breakdown</h3>
            <table className="reservation-nights-table">
              <thead>
                <tr>
                  <th scope="col">Night</th>
                  <th scope="col" className="col-end">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {reservation.nights.map((night) => (
                  <tr key={night.date}>
                    <td>{night.date}</td>
                    <td className="col-end">{formatMinor(night.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="col-end reservation-total">{formatMinor(reservation.totalAmountMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

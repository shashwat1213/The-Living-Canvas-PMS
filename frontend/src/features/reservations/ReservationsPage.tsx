import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { hasPermission } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { formatMinor } from '../rate-plans/money';
import { BookingDialog } from './BookingDialog';
import { AssignRoomDialog } from './AssignRoomDialog';
import { FolioDialog } from '../folios/FolioDialog';
import { cancelReservation, checkOut, listReservations, markNoShow } from './api';
import { ReservationDetailDialog } from './ReservationDetailDialog';
import {
  RESERVATION_STATUS_LABEL,
  RESERVATION_STATUSES,
  canAssignRoom,
  canCancel,
  canCheckIn,
  canCheckOut,
  canMarkNoShow,
  nightCount,
  reservationGuestName,
  type Reservation,
  type ReservationListRow,
  type ReservationStatus,
} from './types';
import './reservations.css';

type StatusFilter = ReservationStatus | 'ALL';
type Pending = { kind: 'cancel' | 'no-show'; reservation: ReservationListRow } | null;

const STATUS_TONE: Record<ReservationStatus, 'positive' | 'accent' | 'neutral' | 'muted'> = {
  CONFIRMED: 'positive',
  CHECKED_IN: 'accent',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'muted',
  NO_SHOW: 'muted',
};

export function ReservationsPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [reservations, setReservations] = useState<ReservationListRow[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  /** Open the room picker for either a bare assignment or a check-in. */
  const [assignTarget, setAssignTarget] = useState<{ reservation: ReservationListRow; mode: 'assign' | 'check-in' } | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<ReservationListRow | null>(null);
  const [folioTarget, setFolioTarget] = useState<ReservationListRow | null>(null);

  const mayRead = hasPermission(session, 'reservations:read');
  const mayManage = hasPermission(session, 'reservations:manage');
  const mayReadFolio = hasPermission(session, 'payments:read');
  const mayManageFolio = hasPermission(session, 'payments:manage');

  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await listReservations(propertyId, {
        search: appliedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        from: from || undefined,
        to: to || undefined,
        page,
      });
      setReservations(result.reservations);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setReservations([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load reservations.');
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, appliedSearch, statusFilter, from, to, page]);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, statusFilter, from, to, propertyId]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [propertyId]);

  function handleBooked(reservation: Reservation) {
    setBookingOpen(false);
    void load();
    flashSuccess(`Booked ${reservation.reference} for ${reservationGuestName(reservation.guest)}.`);
  }

  function handleAssignDone(_reservation: Reservation, message: string) {
    setAssignTarget(null);
    void load();
    flashSuccess(message);
  }

  async function confirmCheckOut() {
    if (!checkOutTarget || !propertyId) return;
    const target = checkOutTarget;
    setWorking(true);
    setError(null);
    try {
      await checkOut(propertyId, target.id);
      setCheckOutTarget(null);
      await load();
      flashSuccess(`${reservationGuestName(target.guest)} checked out of ${target.reference}.`);
    } catch (err) {
      setCheckOutTarget(null);
      setError(err instanceof ApiError ? err.message : 'Could not check this booking out.');
    } finally {
      setWorking(false);
    }
  }

  async function confirmTransition() {
    if (!pending || !propertyId) return;
    const { kind, reservation } = pending;
    setWorking(true);
    setError(null);
    try {
      if (kind === 'cancel') {
        await cancelReservation(propertyId, reservation.id, reason.trim() || undefined);
      } else {
        await markNoShow(propertyId, reservation.id);
      }
      setPending(null);
      setReason('');
      await load();
      flashSuccess(
        kind === 'cancel'
          ? `${reservation.reference} was cancelled.`
          : `${reservation.reference} was marked a no-show.`,
      );
    } catch (err) {
      setPending(null);
      setReason('');
      setError(err instanceof ApiError ? err.message : 'Could not update this reservation.');
    } finally {
      setWorking(false);
    }
  }

  if (!mayRead) {
    return (
      <section className="reservations-page">
        <h1>Reservations</h1>
        <p className="empty-state">
          You don&apos;t have access to reservations. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<ReservationListRow>[] = [
    {
      key: 'reference',
      header: 'Booking',
      render: (r) => (
        <div className="reservation-identity">
          <button type="button" className="reservation-ref" onClick={() => setDetailId(r.id)}>
            {r.reference}
          </button>
          <span className="reservation-guest">{reservationGuestName(r.guest)}</span>
        </div>
      ),
    },
    {
      key: 'stay',
      header: 'Stay',
      render: (r) => {
        const nights = nightCount(r.checkIn, r.checkOut);
        return (
          <div className="reservation-stay">
            <span>
              {r.checkIn} → {r.checkOut}
            </span>
            <span className="reservation-muted">
              {nights} night{nights === 1 ? '' : 's'} · {r.roomType.name}
            </span>
          </div>
        );
      },
    },
    {
      key: 'plan',
      header: 'Rate plan',
      secondary: true,
      render: (r) => (
        <span className="reservation-muted">
          {r.ratePlan.name}
          {r.ratePlan.isRefundable ? '' : ' · Non-refundable'}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'end',
      render: (r) => <span className="reservation-total">{formatMinor(r.totalAmountMinor)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{RESERVATION_STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (r) => (
        <div className="table-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetailId(r.id)}>
            View
          </button>
          {mayReadFolio && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolioTarget(r)}>
              Folio
            </button>
          )}
          {mayManage && canCheckIn(r.status) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAssignTarget({ reservation: r, mode: 'check-in' })}
            >
              Check in
            </button>
          )}
          {mayManage && canCheckOut(r.status) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCheckOutTarget(r)}>
              Check out
            </button>
          )}
          {mayManage && canAssignRoom(r.status) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAssignTarget({ reservation: r, mode: 'assign' })}
            >
              {r.roomId ? 'Change room' : 'Assign room'}
            </button>
          )}
          {mayManage && canMarkNoShow(r.status) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setPending({ kind: 'no-show', reservation: r })}
            >
              No-show
            </button>
          )}
          {mayManage && canCancel(r.status) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm reservation-danger-text"
              onClick={() => {
                setReason('');
                setPending({ kind: 'cancel', reservation: r });
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  const filtersActive = search.trim() !== '' || statusFilter !== 'ALL' || from !== '' || to !== '';

  return (
    <section className="reservations-page">
      <p className="reservations-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="reservations-header">
        <div>
          <h1>Reservations{property ? ` — ${property.name}` : ''}</h1>
          <p className="reservations-subtitle">Bookings for this property — arrivals, in-house stays and departures.</p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary" onClick={() => setBookingOpen(true)}>
            New booking
          </button>
        )}
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="page-success" role="status">
          {success}
        </p>
      )}

      <div className="reservations-filters">
        <div className="field reservations-search">
          <label htmlFor="reservation-search">Search</label>
          <input
            id="reservation-search"
            type="search"
            placeholder="Reference or guest name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="reservation-status-filter">Status</label>
          <select
            id="reservation-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            {RESERVATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {RESERVATION_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="reservation-from">Staying from</label>
          <input
            id="reservation-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="reservation-to">Staying until</label>
          <input
            id="reservation-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={reservations}
        rowKey={(r) => r.id}
        caption="Reservations for this property"
        emptyState={
          filtersActive ? (
            <>
              <p>No reservations match those filters.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm reservations-clear-filters"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('ALL');
                  setFrom('');
                  setTo('');
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>
              {mayManage
                ? 'No reservations yet — take your first booking above.'
                : 'No reservations to show yet.'}
            </p>
          )
        }
      />

      {pageMeta && (
        <Pagination
          page={pageMeta}
          onPageChange={setPage}
          itemLabel="reservations"
          itemLabelSingular="reservation"
          busy={refreshing}
        />
      )}

      {bookingOpen && propertyId && (
        <BookingDialog propertyId={propertyId} onClose={() => setBookingOpen(false)} onBooked={handleBooked} />
      )}

      {assignTarget && propertyId && (
        <AssignRoomDialog
          propertyId={propertyId}
          reservation={assignTarget.reservation}
          mode={assignTarget.mode}
          onClose={() => setAssignTarget(null)}
          onDone={handleAssignDone}
        />
      )}

      {checkOutTarget && (
        <ConfirmDialog
          title="Check out?"
          message={`${reservationGuestName(checkOutTarget.guest)} (${checkOutTarget.reference}) will be checked out and their room released.`}
          confirmLabel="Check out"
          busy={working}
          onConfirm={() => void confirmCheckOut()}
          onCancel={() => setCheckOutTarget(null)}
        />
      )}

      {folioTarget && propertyId && (
        <FolioDialog
          propertyId={propertyId}
          reservationId={folioTarget.id}
          reference={folioTarget.reference}
          mayManage={mayManageFolio}
          onClose={() => setFolioTarget(null)}
        />
      )}

      {detailId && propertyId && (
        <ReservationDetailDialog
          propertyId={propertyId}
          reservationId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      {pending?.kind === 'no-show' && (
        <ConfirmDialog
          title="Mark as no-show?"
          message={`${pending.reservation.reference} for ${reservationGuestName(pending.reservation.guest)} will be marked a no-show and its room released.`}
          confirmLabel="Mark no-show"
          busy={working}
          onConfirm={() => void confirmTransition()}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'cancel' && (
        <ConfirmDialog
          title="Cancel reservation?"
          message={`${pending.reservation.reference} for ${reservationGuestName(pending.reservation.guest)} will be cancelled and its room released. This can't be undone.`}
          confirmLabel="Cancel reservation"
          destructive
          busy={working}
          onConfirm={() => void confirmTransition()}
          onCancel={() => {
            setPending(null);
            setReason('');
          }}
        >
          <div className="field reservation-cancel-reason">
            <label htmlFor="cancel-reason">Reason (optional)</label>
            <input
              id="cancel-reason"
              type="text"
              value={reason}
              maxLength={500}
              placeholder="Guest requested, duplicate booking…"
              onChange={(event) => setReason(event.target.value)}
              disabled={working}
            />
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}

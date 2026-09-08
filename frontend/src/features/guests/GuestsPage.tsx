import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../auth/useAuth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { deleteGuest, listGuests } from './api';
import { GuestDialog } from './GuestDialog';
import { canManageGuests, canReadGuests } from './permissions';
import { guestFullName, type Guest } from './types';
import './guests.css';

export function GuestsPage() {
  const { session } = useAuth();

  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** True while refetching an already-loaded list, so the table stays on
   * screen instead of collapsing back to a loading placeholder. */
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  /** The term actually sent to the server — see the debounce effect below. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [dialogGuest, setDialogGuest] = useState<Guest | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Guest | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mayRead = canReadGuests(session);
  const mayManage = canManageGuests(session);

  // The same brief, self-clearing confirmation the other list pages use —
  // the refreshed table is the lasting evidence.
  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await listGuests({
        search: appliedSearch || undefined,
        page,
      });
      setGuests(result.guests);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setGuests([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load guests.');
    } finally {
      setRefreshing(false);
    }
  }, [appliedSearch, page]);

  // Debounce the search box so typing produces one request when the user
  // pauses, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any change to what's being asked for resets to the first page.
  useEffect(() => {
    setPage(1);
  }, [appliedSearch]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  function openCreate() {
    setDialogGuest(null);
    setDialogOpen(true);
  }

  function openGuest(guest: Guest) {
    setDialogGuest(guest);
    setDialogOpen(true);
  }

  async function handleDialogSaved(message: string) {
    setDialogOpen(false);
    await load();
    flashSuccess(message);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const guest = pendingDelete;
    setDeleting(true);
    setError(null);
    try {
      await deleteGuest(guest.id);
      setPendingDelete(null);
      await load();
      flashSuccess(`${guestFullName(guest)} was deleted.`);
    } catch (err) {
      setPendingDelete(null);
      // A guest with reservations returns a 409 with a specific message —
      // surface the server's wording verbatim rather than a generic error.
      setError(err instanceof ApiError ? err.message : 'Could not delete this guest.');
    } finally {
      setDeleting(false);
    }
  }

  // Permission-gated at the route as well as in the nav: reaching this page
  // directly by URL without `guests:read` gets an explanation rather than an
  // empty table or a raw 403 from the first request.
  if (!mayRead) {
    return (
      <section className="guests-page">
        <h1>Guests</h1>
        <p className="empty-state">
          You don&apos;t have access to guest profiles. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<Guest>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (guest) => (
        <div className="guest-identity">
          <span className="guest-name">{guestFullName(guest)}</span>
          {guest.email && <span className="guest-email">{guest.email}</span>}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      secondary: true,
      render: (guest) => guest.phone ?? <span className="guest-muted">—</span>,
    },
    {
      key: 'reservations',
      header: 'Reservations',
      align: 'end',
      render: (guest) => (
        <span className="guest-muted">
          {guest.reservationCount} {guest.reservationCount === 1 ? 'booking' : 'bookings'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (guest) => (
        <div className="table-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openGuest(guest)}>
            {mayManage ? 'Edit' : 'View'}
          </button>
          {mayManage && (
            <button
              type="button"
              className={
                guest.reservationCount === 0
                  ? 'btn btn-ghost btn-sm guest-danger-text'
                  : 'btn btn-ghost btn-sm'
              }
              onClick={() => setPendingDelete(guest)}
              // A guest with bookings can't be deleted (the service returns a
              // 409). Disabling here explains the absence up front rather than
              // letting the click earn an error — the count is the reason.
              disabled={guest.reservationCount > 0}
              title={
                guest.reservationCount > 0
                  ? 'Guests with reservations keep their profile and cannot be deleted.'
                  : undefined
              }
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  const filtersActive = search.trim() !== '';

  return (
    <section className="guests-page">
      <header className="guests-header">
        <div>
          <h1>Guests</h1>
          <p className="guests-subtitle">
            Guest profiles your organization owns — reusable across every property.
          </p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Add guest
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

      <div className="guests-filters">
        <div className="field guests-search">
          <label htmlFor="guests-search">Search</label>
          <input
            id="guests-search"
            type="search"
            placeholder="Name, email or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={guests}
        rowKey={(guest) => guest.id}
        caption="Guest profiles in your organization"
        emptyState={
          filtersActive ? (
            <>
              <p>No guests match that search.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm guests-clear-filters"
                onClick={() => setSearch('')}
              >
                Clear search
              </button>
            </>
          ) : (
            <p>{mayManage ? 'No guests yet — add your first guest above.' : 'No guests to show yet.'}</p>
          )
        }
      />

      {pageMeta && (
        <Pagination page={pageMeta} onPageChange={setPage} itemLabel="guests" itemLabelSingular="guest" busy={refreshing} />
      )}

      {dialogOpen && (
        <GuestDialog
          guest={dialogGuest}
          onClose={() => setDialogOpen(false)}
          onSaved={(message) => void handleDialogSaved(message)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete guest?"
          message={`${guestFullName(pendingDelete)} will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}

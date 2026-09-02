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
import { deleteRoomType, listRoomTypes, updateRoomType } from './api';
import { RoomTypeDialog } from './RoomTypeDialog';
import { roomTypeStatusLabel, type RoomType } from './types';
import './room-types.css';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/** Which confirmation is open, and for which type. */
type Pending = { kind: 'retire' | 'delete'; roomType: RoomType } | null;

export function RoomTypesPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const [dialogRoomType, setDialogRoomType] = useState<RoomType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);

  // Presentation only — the backend enforces these on every request.
  // `room-types:manage` is deliberately not `rooms:update`: the front desk
  // changes a room's status, but it does not rename the catalogue every
  // future rate and reservation hangs off.
  const mayManage = hasPermission(session, 'room-types:manage');

  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await listRoomTypes(propertyId, {
        search: appliedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setRoomTypes(result.roomTypes);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setRoomTypes([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load room types.');
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, appliedSearch, statusFilter, page]);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, statusFilter, propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The property heading is a separate request from the list, so a failure
  // to name the property doesn't take the table down with it.
  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [propertyId]);

  async function handleSaved(message: string) {
    setDialogOpen(false);
    await load();
    flashSuccess(message);
  }

  /** Retire and restore are the same PATCH; only restore needs no warning. */
  async function setActive(roomType: RoomType, isActive: boolean) {
    if (!propertyId) return;
    setWorking(true);
    setError(null);
    try {
      await updateRoomType(propertyId, roomType.id, { isActive });
      setPending(null);
      await load();
      flashSuccess(
        isActive
          ? `Room type "${roomType.name}" is active again.`
          : `Room type "${roomType.name}" was retired — existing rooms keep it.`,
      );
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : 'Could not update this room type.');
    } finally {
      setWorking(false);
    }
  }

  async function confirmDelete(target: RoomType) {
    if (!propertyId) return;
    setWorking(true);
    setError(null);
    try {
      await deleteRoomType(propertyId, target.id);
      setPending(null);
      await load();
      flashSuccess(`Room type "${target.name}" was deleted.`);
    } catch (err) {
      setPending(null);
      // A 409 here means rooms were assigned between this page loading and
      // the click. The server's message already names the count and the
      // retirement path, so it is shown as-is rather than paraphrased.
      const message = err instanceof ApiError ? err.message : 'Could not delete this room type.';
      // The reload comes first — the room count on screen is what turned
      // out to be stale — but it clears the banner on success, so the
      // message is set after it rather than before.
      await load();
      setError(message);
    } finally {
      setWorking(false);
    }
  }

  const columns: Column<RoomType>[] = [
    {
      key: 'name',
      header: 'Room type',
      render: (roomType) => (
        <div className="room-type-identity">
          <span className="room-type-name">{roomType.name}</span>
          {roomType.code && <span className="room-type-code">{roomType.code}</span>}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      secondary: true,
      render: (roomType) => (
        <span className="room-type-muted">{roomType.description ?? '—'}</span>
      ),
    },
    {
      key: 'roomCount',
      header: 'Rooms',
      secondary: true,
      render: (roomType) => <span className="room-type-muted">{roomType.roomCount}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (roomType) => (
        <Badge tone={roomType.isActive ? 'positive' : 'muted'}>{roomTypeStatusLabel(roomType)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (roomType) => (
        <div className="table-actions">
          {mayManage && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDialogRoomType(roomType);
                setDialogOpen(true);
              }}
            >
              Edit
            </button>
          )}
          {mayManage &&
            (roomType.isActive ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPending({ kind: 'retire', roomType })}
              >
                Retire
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void setActive(roomType, true)}
                disabled={working}
              >
                Restore
              </button>
            ))}
          {/*
            Delete is offered only for a type nothing uses. The API refuses
            it otherwise — the FK is SET NULL, so a hard delete would
            quietly un-type a floor of rooms — and offering a button whose
            only outcome is a 409 is worse than not offering it. Retire is
            the operation that was meant in that case.
          */}
          {mayManage && roomType.roomCount === 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm room-type-danger-text"
              onClick={() => setPending({ kind: 'delete', roomType })}
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  const filtersActive = search.trim() !== '' || statusFilter !== 'ALL';

  return (
    <section className="room-types-page">
      <p className="room-types-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
        {propertyId && (
          <>
            <span aria-hidden="true"> · </span>
            <Link to={`/app/properties/${propertyId}/rooms`}>Rooms</Link>
          </>
        )}
      </p>

      <header className="room-types-header">
        <div>
          <h1>Room types{property ? ` — ${property.name}` : ''}</h1>
          <p className="room-types-subtitle">
            The sellable categories at this property. Rates and availability will hang off these.
          </p>
        </div>
        {mayManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDialogRoomType(null);
              setDialogOpen(true);
            }}
          >
            Add room type
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

      <div className="room-types-filters">
        <div className="field room-types-search">
          <label htmlFor="room-type-search">Search</label>
          <input
            id="room-type-search"
            type="search"
            placeholder="Name, code or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="room-type-status-filter">Status</label>
          <select
            id="room-type-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Retired</option>
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={roomTypes}
        rowKey={(roomType) => roomType.id}
        caption="Room types at this property"
        emptyState={
          filtersActive ? (
            <>
              <p>No room types match those filters.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm room-types-clear-filters"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('ALL');
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>
              {mayManage
                ? 'No room types yet — add your first one above. Until then, rooms keep a free-text type.'
                : 'No room types to show yet.'}
            </p>
          )
        }
      />

      {pageMeta && (
        <Pagination page={pageMeta} onPageChange={setPage} itemLabel="room types" busy={refreshing} />
      )}

      {dialogOpen && propertyId && (
        <RoomTypeDialog
          propertyId={propertyId}
          roomType={dialogRoomType}
          onClose={() => setDialogOpen(false)}
          onSaved={(message) => void handleSaved(message)}
        />
      )}

      {pending?.kind === 'retire' && (
        <ConfirmDialog
          title="Retire room type?"
          message={
            `"${pending.roomType.name}" stops being offered for new rooms. ` +
            (pending.roomType.roomCount > 0
              ? `The ${pending.roomType.roomCount} room${pending.roomType.roomCount === 1 ? '' : 's'} already using it keep it, and their history is unchanged.`
              : 'It can be restored at any time.')
          }
          confirmLabel="Retire room type"
          busy={working}
          onConfirm={() => void setActive(pending.roomType, false)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete room type?"
          message={`Room type "${pending.roomType.name}" will be permanently deleted. No rooms use it. This cannot be undone.`}
          confirmLabel="Delete room type"
          destructive
          busy={working}
          onConfirm={() => void confirmDelete(pending.roomType)}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

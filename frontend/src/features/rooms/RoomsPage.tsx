import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { hasPermission } from '../../auth/session';
import { Badge } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { deleteRoom, listRooms, updateRoom } from './api';
import { RoomDialog } from './RoomDialog';
import { ROOM_STATUSES, ROOM_STATUS_LABEL, type Room, type RoomStatus } from './types';
import './rooms.css';

type StatusFilter = 'ALL' | RoomStatus;

const STATUS_TONE: Record<RoomStatus, 'positive' | 'muted' | 'neutral'> = {
  ACTIVE: 'positive',
  INACTIVE: 'muted',
  MAINTENANCE: 'neutral',
};

export function RoomsPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const [dialogRoom, setDialogRoom] = useState<Room | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null);
  const [deleting, setDeleting] = useState(false);

  const mayCreate = hasPermission(session, 'rooms:create');
  const mayUpdate = hasPermission(session, 'rooms:update');
  const mayDelete = hasPermission(session, 'rooms:delete');

  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await listRooms(propertyId, {
        search: appliedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setRooms(result.rooms);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setRooms([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load rooms.');
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

  // The property heading is a separate request from the room list, so a
  // failure to name the property doesn't take the table down with it.
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

  async function handleStatusChange(room: Room, status: RoomStatus) {
    if (!propertyId) return;
    setError(null);
    try {
      await updateRoom(propertyId, room.id, { status });
      await load();
      flashSuccess(`Room "${room.name}" marked ${ROOM_STATUS_LABEL[status]}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this room.');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !propertyId) return;
    const target = pendingDelete;
    setDeleting(true);
    setError(null);
    try {
      await deleteRoom(propertyId, target.id);
      setPendingDelete(null);
      await load();
      flashSuccess(`Room "${target.name}" was deleted.`);
    } catch (err) {
      setPendingDelete(null);
      setError(err instanceof ApiError ? err.message : 'Could not delete this room.');
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<Room>[] = [
    {
      key: 'name',
      header: 'Room',
      render: (room) => (
        <div className="room-identity">
          <span className="room-name">{room.name}</span>
          <span className="room-muted">{room.roomType}</span>
        </div>
      ),
    },
    {
      key: 'floor',
      header: 'Floor',
      secondary: true,
      render: (room) => <span className="room-muted">{room.floor ?? '—'}</span>,
    },
    {
      key: 'capacity',
      header: 'Sleeps',
      secondary: true,
      render: (room) => <span className="room-muted">{room.capacity}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (room) =>
        mayUpdate ? (
          // Status is the field changed most often, so it stays editable
          // inline rather than requiring the dialog for a one-field edit.
          <select
            className="room-status-select"
            aria-label={`Status for room ${room.name}`}
            value={room.status}
            onChange={(event) => void handleStatusChange(room, event.target.value as RoomStatus)}
          >
            {ROOM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ROOM_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        ) : (
          <Badge tone={STATUS_TONE[room.status]}>{ROOM_STATUS_LABEL[room.status]}</Badge>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (room) => (
        <div className="table-actions">
          {mayUpdate && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDialogRoom(room);
                setDialogOpen(true);
              }}
            >
              Edit
            </button>
          )}
          {mayDelete && (
            <button
              type="button"
              className="btn btn-ghost btn-sm room-danger-text"
              onClick={() => setPendingDelete(room)}
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
    <section className="rooms-page">
      <p className="rooms-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="rooms-header">
        <div>
          <h1>Rooms{property ? ` — ${property.name}` : ''}</h1>
          <p className="rooms-subtitle">Operational status only — occupancy arrives with bookings.</p>
        </div>
        {mayCreate && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDialogRoom(null);
              setDialogOpen(true);
            }}
          >
            Add room
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

      <div className="rooms-filters">
        <div className="field rooms-search">
          <label htmlFor="room-search">Search</label>
          <input
            id="room-search"
            type="search"
            placeholder="Name, type or floor"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="room-status-filter">Status</label>
          <select
            id="room-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            {ROOM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ROOM_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rooms}
        rowKey={(room) => room.id}
        caption="Rooms at this property"
        emptyState={
          filtersActive ? (
            <>
              <p>No rooms match those filters.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm rooms-clear-filters"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('ALL');
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>{mayCreate ? 'No rooms yet — add your first one above.' : 'No rooms to show yet.'}</p>
          )
        }
      />

      {pageMeta && <Pagination page={pageMeta} onPageChange={setPage} itemLabel="rooms" busy={refreshing} />}

      {dialogOpen && propertyId && (
        <RoomDialog
          propertyId={propertyId}
          room={dialogRoom}
          onClose={() => setDialogOpen(false)}
          onSaved={(message) => void handleSaved(message)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete room?"
          message={`Room "${pendingDelete.name}" will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete room"
          destructive
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}

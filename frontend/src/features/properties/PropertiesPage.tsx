import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { hasPermission } from '../../auth/session';
import { Badge } from '../../components/Badge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { deleteProperty, listProperties } from './api';
import { PropertyDialog } from './PropertyDialog';
import { locationLabel, type Property } from './types';
import './properties.css';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export function PropertiesPage() {
  const { session } = useAuth();

  const [properties, setProperties] = useState<Property[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const [dialogProperty, setDialogProperty] = useState<Property | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Presentation only — the backend enforces these on every request.
  const mayCreate = hasPermission(session, 'properties:create');
  const mayUpdate = hasPermission(session, 'properties:update');
  const mayDelete = hasPermission(session, 'properties:delete');
  // The catalogue is a separate permission pair from properties and rooms
  // — STAFF can read it, only MANAGER and above configure it.
  const mayReadRoomTypes = hasPermission(session, 'room-types:read');

  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await listProperties({
        search: appliedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setProperties(result.properties);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setProperties([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load properties.');
    } finally {
      setRefreshing(false);
    }
  }, [appliedSearch, statusFilter, page]);

  // One request per pause, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A narrowed result set may not have the page currently being viewed.
  useEffect(() => {
    setPage(1);
  }, [appliedSearch, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaved(message: string) {
    setDialogOpen(false);
    await load();
    flashSuccess(message);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    setError(null);
    try {
      await deleteProperty(target.id);
      setPendingDelete(null);
      await load();
      flashSuccess(`"${target.name}" was deleted.`);
    } catch (err) {
      setPendingDelete(null);
      setError(err instanceof ApiError ? err.message : 'Could not delete this property.');
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<Property>[] = [
    {
      key: 'name',
      header: 'Property',
      render: (property) => (
        <div className="property-identity">
          <span className="property-name">{property.name}</span>
          <span className="property-slug">/{property.slug}</span>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      secondary: true,
      render: (property) => {
        const label = locationLabel(property);
        return label ? <span className="property-muted">{label}</span> : <span className="property-muted">—</span>;
      },
    },
    {
      key: 'timezone',
      header: 'Timezone',
      secondary: true,
      render: (property) => <span className="property-muted">{property.timezone}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (property) => (
        <Badge tone={property.isActive ? 'positive' : 'muted'}>{property.isActive ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (property) => (
        <div className="table-actions">
          <Link className="btn btn-ghost btn-sm" to={`/app/properties/${property.id}/rooms`}>
            Rooms
          </Link>
          {/* Presentation-only gating, like every other control here: the
              route and the API both enforce `room-types:read` themselves. */}
          {mayReadRoomTypes && (
            <Link className="btn btn-ghost btn-sm" to={`/app/properties/${property.id}/room-types`}>
              Room types
            </Link>
          )}
          {mayUpdate && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDialogProperty(property);
                setDialogOpen(true);
              }}
            >
              Edit
            </button>
          )}
          {mayDelete && (
            <button
              type="button"
              className="btn btn-ghost btn-sm property-danger-text"
              onClick={() => setPendingDelete(property)}
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
    <section className="properties-page">
      <header className="properties-header">
        <div>
          <h1>Properties</h1>
          <p className="properties-subtitle">The venues your organization operates.</p>
        </div>
        {mayCreate && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDialogProperty(null);
              setDialogOpen(true);
            }}
          >
            Add property
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

      <div className="properties-filters">
        <div className="field properties-search">
          <label htmlFor="property-search">Search</label>
          <input
            id="property-search"
            type="search"
            placeholder="Name, slug or city"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="property-status-filter">Status</label>
          <select
            id="property-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={properties}
        rowKey={(property) => property.id}
        caption="Properties in your organization"
        emptyState={
          filtersActive ? (
            <>
              <p>No properties match those filters.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm properties-clear-filters"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('ALL');
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>{mayCreate ? 'No properties yet — add your first one above.' : 'No properties to show yet.'}</p>
          )
        }
      />

      {pageMeta && (
        <Pagination page={pageMeta} onPageChange={setPage} itemLabel="properties" busy={refreshing} />
      )}

      {dialogOpen && (
        <PropertyDialog
          property={dialogProperty}
          onClose={() => setDialogOpen(false)}
          onSaved={(message) => void handleSaved(message)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete property?"
          message={`"${pendingDelete.name}" and every room recorded against it will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete property"
          destructive
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}

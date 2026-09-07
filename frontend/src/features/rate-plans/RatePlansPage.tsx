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
import { getRoomType } from '../room-types/api';
import type { RoomType } from '../room-types/types';
import { deleteRatePlan, listRatePlans, updateRatePlan } from './api';
import { RateCalendar } from './RateCalendar';
import { RatePlanDialog } from './RatePlanDialog';
import { ratePlanStatusLabel, type RatePlan } from './types';
import './rate-plans.css';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type Pending = { kind: 'retire' | 'delete'; ratePlan: RatePlan } | null;

export function RatePlansPage() {
  const { propertyId, roomTypeId } = useParams<{ propertyId: string; roomTypeId: string }>();
  const { session } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [roomType, setRoomType] = useState<RoomType | null>(null);
  const [ratePlans, setRatePlans] = useState<RatePlan[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(1);

  const [dialogPlan, setDialogPlan] = useState<RatePlan | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [calendarPlan, setCalendarPlan] = useState<RatePlan | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);

  const mayManage = hasPermission(session, 'rate-plans:manage');

  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  const load = useCallback(async () => {
    if (!propertyId || !roomTypeId) return;
    setRefreshing(true);
    try {
      const result = await listRatePlans(propertyId, roomTypeId, {
        search: appliedSearch || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setRatePlans(result.ratePlans);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setRatePlans([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load rate plans.');
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, roomTypeId, appliedSearch, statusFilter, page]);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, statusFilter, propertyId, roomTypeId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId).then(setProperty).catch(() => setProperty(null));
  }, [propertyId]);

  useEffect(() => {
    if (!propertyId || !roomTypeId) return;
    getRoomType(propertyId, roomTypeId).then(setRoomType).catch(() => setRoomType(null));
  }, [propertyId, roomTypeId]);

  async function handleSaved(message: string) {
    setDialogOpen(false);
    await load();
    flashSuccess(message);
  }

  async function setActive(ratePlan: RatePlan, isActive: boolean) {
    if (!propertyId || !roomTypeId) return;
    setWorking(true);
    setError(null);
    try {
      await updateRatePlan(propertyId, roomTypeId, ratePlan.id, { isActive });
      setPending(null);
      await load();
      flashSuccess(
        isActive
          ? `Rate plan "${ratePlan.name}" is active again.`
          : `Rate plan "${ratePlan.name}" was retired.`,
      );
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : 'Could not update this rate plan.');
    } finally {
      setWorking(false);
    }
  }

  async function confirmDelete(target: RatePlan) {
    if (!propertyId || !roomTypeId) return;
    setWorking(true);
    setError(null);
    try {
      await deleteRatePlan(propertyId, roomTypeId, target.id);
      setPending(null);
      await load();
      flashSuccess(`Rate plan "${target.name}" was deleted.`);
    } catch (err) {
      setPending(null);
      const message = err instanceof ApiError ? err.message : 'Could not delete this rate plan.';
      await load();
      setError(message);
    } finally {
      setWorking(false);
    }
  }

  const columns: Column<RatePlan>[] = [
    {
      key: 'name',
      header: 'Rate plan',
      render: (plan) => (
        <div className="rate-plan-identity">
          <span className="rate-plan-name">{plan.name}</span>
          {plan.code && <span className="rate-plan-code">{plan.code}</span>}
        </div>
      ),
    },
    {
      key: 'policy',
      header: 'Policy',
      render: (plan) => (
        <Badge tone={plan.isRefundable ? 'accent' : 'muted'}>
          {plan.isRefundable ? 'Refundable' : 'Non-refundable'}
        </Badge>
      ),
    },
    {
      key: 'pricedDates',
      header: 'Priced nights',
      secondary: true,
      render: (plan) => (
        <span className="rate-plan-muted">
          {plan.pricedDates === 0 ? 'None yet' : `${plan.pricedDates} night${plan.pricedDates === 1 ? '' : 's'}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (plan) => <Badge tone={plan.isActive ? 'positive' : 'muted'}>{ratePlanStatusLabel(plan)}</Badge>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (plan) => (
        <div className="table-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCalendarPlan(plan)}>
            {mayManage ? 'Rates' : 'View rates'}
          </button>
          {mayManage && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDialogPlan(plan);
                setDialogOpen(true);
              }}
            >
              Edit
            </button>
          )}
          {mayManage &&
            (plan.isActive ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending({ kind: 'retire', ratePlan: plan })}>
                Retire
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void setActive(plan, true)}
                disabled={working}
              >
                Restore
              </button>
            ))}
          {mayManage && (
            <button
              type="button"
              className="btn btn-ghost btn-sm rate-plan-danger-text"
              onClick={() => setPending({ kind: 'delete', ratePlan: plan })}
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
    <section className="rate-plans-page">
      <p className="rate-plans-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
        {propertyId && (
          <>
            <span aria-hidden="true"> · </span>
            <Link to={`/app/properties/${propertyId}/room-types`}>Room types</Link>
          </>
        )}
      </p>

      <header className="rate-plans-header">
        <div>
          <h1>Rate plans{roomType ? ` — ${roomType.name}` : ''}</h1>
          <p className="rate-plans-subtitle">
            {property ? `${property.name}. ` : ''}How this room type is sold and priced per night.
          </p>
        </div>
        {mayManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setDialogPlan(null);
              setDialogOpen(true);
            }}
          >
            Add rate plan
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

      <div className="rate-plans-filters">
        <div className="field rate-plans-search">
          <label htmlFor="rate-plan-search">Search</label>
          <input
            id="rate-plan-search"
            type="search"
            placeholder="Name, code or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="rate-plan-status-filter">Status</label>
          <select
            id="rate-plan-status-filter"
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
        rows={ratePlans}
        rowKey={(plan) => plan.id}
        caption="Rate plans for this room type"
        emptyState={
          filtersActive ? (
            <>
              <p>No rate plans match those filters.</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm rate-plans-clear-filters"
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
                ? 'No rate plans yet — add one, then set its nightly prices from the rates calendar.'
                : 'No rate plans to show yet.'}
            </p>
          )
        }
      />

      {pageMeta && <Pagination page={pageMeta} onPageChange={setPage} itemLabel="rate plans" busy={refreshing} />}

      {dialogOpen && propertyId && roomTypeId && (
        <RatePlanDialog
          propertyId={propertyId}
          roomTypeId={roomTypeId}
          ratePlan={dialogPlan}
          onClose={() => setDialogOpen(false)}
          onSaved={(message) => void handleSaved(message)}
        />
      )}

      {calendarPlan && propertyId && roomTypeId && (
        <RateCalendar
          propertyId={propertyId}
          roomTypeId={roomTypeId}
          ratePlan={calendarPlan}
          mayManage={mayManage}
          onClose={() => setCalendarPlan(null)}
          onSaved={(message) => {
            void load();
            flashSuccess(message);
          }}
        />
      )}

      {pending?.kind === 'retire' && (
        <ConfirmDialog
          title="Retire rate plan?"
          message={`"${pending.ratePlan.name}" stops being offered for new bookings. Its prices are kept and it can be restored at any time.`}
          confirmLabel="Retire rate plan"
          busy={working}
          onConfirm={() => void setActive(pending.ratePlan, false)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete rate plan?"
          message={
            `Rate plan "${pending.ratePlan.name}" and all its prices will be permanently deleted. ` +
            'This cannot be undone — retire it instead if you may sell it again.'
          }
          confirmLabel="Delete rate plan"
          destructive
          busy={working}
          onConfirm={() => void confirmDelete(pending.ratePlan)}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

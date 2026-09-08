import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, type BadgeTone } from '../../components/Badge';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { listWorkOrders, updateWorkOrder } from './api';
import { canManageMaintenance, canReadMaintenance } from './permissions';
import { WorkOrderDialog } from './WorkOrderDialog';
import {
  WORK_ORDER_CATEGORY_LABEL,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_PRIORITY_LABEL,
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_STATUSES,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from './types';
import './maintenance.css';

const STATUS_TONE: Record<WorkOrderStatus, BadgeTone> = {
  OPEN: 'accent',
  IN_PROGRESS: 'accent',
  RESOLVED: 'positive',
  CANCELLED: 'muted',
};

const PRIORITY_TONE: Record<WorkOrderPriority, BadgeTone> = {
  LOW: 'muted',
  MEDIUM: 'neutral',
  HIGH: 'accent',
  URGENT: 'accent',
};

export function MaintenancePage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const mayRead = canReadMaintenance(session);
  const mayManage = canManageMaintenance(session);

  const [property, setProperty] = useState<Property | null>(null);
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<WorkOrderPriority | ''>('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      const result = await listWorkOrders(propertyId, {
        page,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
      });
      setOrders(result.workOrders);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setOrders([]);
      setError(err instanceof ApiError ? err.message : 'Could not load work orders.');
    } finally {
      setBusy(false);
    }
  }, [propertyId, page, statusFilter, priorityFilter]);

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

  async function transition(order: WorkOrder, next: WorkOrderStatus) {
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    try {
      await updateWorkOrder(propertyId, order.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the work order.');
      setBusy(false);
    }
  }

  if (!mayRead) {
    return (
      <section className="maintenance-page">
        <h1>Maintenance</h1>
        <p className="empty-state">
          You don&apos;t have access to maintenance. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<WorkOrder>[] = [
    {
      key: 'title',
      header: 'Work order',
      render: (o) => (
        <div className="mx-title-cell">
          <span className="mx-title">{o.title}</span>
          <span className="mx-muted">
            {WORK_ORDER_CATEGORY_LABEL[o.category]}
            {o.room ? ` · Room ${o.room.name}` : ' · Property-wide'}
            {o.assignedTo ? ` · ${o.assignedTo.firstName} ${o.assignedTo.lastName}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (o) => <Badge tone={PRIORITY_TONE[o.priority]}>{WORK_ORDER_PRIORITY_LABEL[o.priority]}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <div className="mx-status-cell">
          <Badge tone={STATUS_TONE[o.status]}>{WORK_ORDER_STATUS_LABEL[o.status]}</Badge>
          {o.takesRoomOutOfService && <Badge tone="muted">Room out of service</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      render: (o) =>
        mayManage ? (
          <div className="table-actions">
            {o.status === 'OPEN' && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void transition(o, 'IN_PROGRESS')}>
                Start
              </button>
            )}
            {(o.status === 'OPEN' || o.status === 'IN_PROGRESS') && (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void transition(o, 'RESOLVED')}>
                  Resolve
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void transition(o, 'CANCELLED')}>
                  Cancel
                </button>
              </>
            )}
            {(o.status === 'RESOLVED' || o.status === 'CANCELLED') && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void transition(o, 'OPEN')}>
                Reopen
              </button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <section className="maintenance-page">
      <p className="mx-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="mx-header">
        <div>
          <h1>Maintenance{property ? ` — ${property.name}` : ''}</h1>
          <p className="mx-subtitle">
            Engineering work orders. Resolving an order that took a room out of service returns it to sellable inventory.
          </p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialogOpen(true)}>
            New work order
          </button>
        )}
      </header>

      <div className="mx-filters">
        <label className="mx-filter-label">
          Status
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as WorkOrderStatus | '');
              setPage(1);
            }}
            disabled={busy}
          >
            <option value="">All</option>
            {WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {WORK_ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="mx-filter-label">
          Priority
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value as WorkOrderPriority | '');
              setPage(1);
            }}
            disabled={busy}
          >
            <option value="">All</option>
            {WORK_ORDER_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {WORK_ORDER_PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={orders}
        rowKey={(o) => o.id}
        caption="Maintenance work orders for this property"
        emptyState="No work orders match this filter. Log one when something needs fixing."
        loadingLabel="Loading work orders…"
      />

      {pageMeta && <Pagination page={pageMeta} onPageChange={setPage} itemLabel="work orders" itemLabelSingular="work order" busy={busy} />}

      {dialogOpen && propertyId && (
        <WorkOrderDialog
          propertyId={propertyId}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false);
            setPage(1);
            void load();
          }}
        />
      )}
    </section>
  );
}

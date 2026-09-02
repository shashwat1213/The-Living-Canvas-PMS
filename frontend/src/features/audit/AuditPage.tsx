import { useCallback, useEffect, useState } from 'react';

import { hasPermission } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { listAuditLogs } from './api';
import { AuditEntryDialog } from './AuditEntryDialog';
import { summarize } from './summarize';
import {
  ACTION_LABEL,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  ENTITY_TYPE_LABEL,
  actorLabel,
  isDestructiveAction,
  type AuditEntry,
} from './types';
import './audit.css';

/**
 * Relative time for recent entries, absolute for older ones. An audit
 * trail is usually read right after something happened ("what did they
 * just do?"), where "12 minutes ago" answers faster than a timestamp;
 * past a day, the date is what people actually want.
 */
function formatWhen(iso: string): { label: string; title: string } {
  const date = new Date(iso);
  const title = date.toLocaleString();
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (Number.isNaN(seconds)) return { label: iso, title: iso };
  if (seconds < 60) return { label: 'just now', title };
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return { label: `${minutes} min ago`, title };
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return { label: `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`, title };
  }
  return { label: date.toLocaleDateString(), title };
}

export function AuditPage() {
  const { session } = useAuth();

  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('ALL');
  /** Set by drilling into a row; there is no free-text UUID input. */
  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<AuditEntry | null>(null);

  // Presentation only. `audit:read` is enforced on every request; this
  // just avoids rendering a page whose first call would be a 403.
  const mayRead = hasPermission(session, 'audit:read');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await listAuditLogs({
        action: actionFilter === 'ALL' ? undefined : actionFilter,
        entityType: entityTypeFilter === 'ALL' ? undefined : entityTypeFilter,
        actorUserId: actorFilter ?? undefined,
        entityId: entityFilter ?? undefined,
        page,
      });
      setEntries(result.auditLogs);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setEntries([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load the activity log.');
    } finally {
      setRefreshing(false);
    }
  }, [actionFilter, entityTypeFilter, actorFilter, entityFilter, page]);

  // A narrowed result set may not have the page currently being viewed.
  useEffect(() => {
    setPage(1);
  }, [actionFilter, entityTypeFilter, actorFilter, entityFilter]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  function clearFilters() {
    setActionFilter('ALL');
    setEntityTypeFilter('ALL');
    setActorFilter(null);
    setEntityFilter(null);
  }

  if (!mayRead) {
    return (
      <section className="audit-page">
        <h1>Activity</h1>
        <p className="empty-state">
          You don&apos;t have access to the activity log. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<AuditEntry>[] = [
    {
      key: 'when',
      header: 'When',
      render: (entry) => {
        const when = formatWhen(entry.createdAt);
        return (
          <time className="audit-when" dateTime={entry.createdAt} title={when.title}>
            {when.label}
          </time>
        );
      },
    },
    {
      key: 'action',
      header: 'Action',
      render: (entry) => (
        <Badge tone={isDestructiveAction(entry.action) ? 'muted' : 'neutral'}>
          {ACTION_LABEL[entry.action as keyof typeof ACTION_LABEL] ?? entry.action}
        </Badge>
      ),
    },
    {
      key: 'summary',
      header: 'What happened',
      render: (entry) => <span className="audit-summary">{summarize(entry)}</span>,
    },
    {
      key: 'actor',
      header: 'By',
      secondary: true,
      render: (entry) => <span className="audit-actor">{actorLabel(entry)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Details</span>,
      align: 'end',
      render: (entry) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(entry)}>
          Details
        </button>
      ),
    },
  ];

  const filtersActive =
    actionFilter !== 'ALL' || entityTypeFilter !== 'ALL' || actorFilter !== null || entityFilter !== null;

  return (
    <section className="audit-page">
      <header className="audit-header">
        <div>
          <h1>Activity</h1>
          <p className="audit-subtitle">
            Every change made in your organization, newest first. This record cannot be edited or deleted.
          </p>
        </div>
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <div className="audit-filters">
        <div className="field">
          <label htmlFor="audit-action-filter">Action</label>
          <select
            id="audit-action-filter"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
          >
            <option value="ALL">All actions</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABEL[action]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="audit-entity-filter">Record type</label>
          <select
            id="audit-entity-filter"
            value={entityTypeFilter}
            onChange={(event) => setEntityTypeFilter(event.target.value)}
          >
            <option value="ALL">All records</option>
            {AUDIT_ENTITY_TYPES.map((entityType) => (
              <option key={entityType} value={entityType}>
                {ENTITY_TYPE_LABEL[entityType]}
              </option>
            ))}
          </select>
        </div>

        {filtersActive && (
          <button type="button" className="btn btn-ghost btn-sm audit-reset" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Drill-down filters are set by clicking into an entry, so they are
          shown as removable chips rather than as raw UUID inputs. */}
      {(actorFilter || entityFilter) && (
        <div className="audit-chips" role="status">
          {actorFilter && (
            <button type="button" className="audit-chip" onClick={() => setActorFilter(null)}>
              Showing one person&apos;s actions <span aria-hidden="true">×</span>
              <span className="sr-only">(remove filter)</span>
            </button>
          )}
          {entityFilter && (
            <button type="button" className="audit-chip" onClick={() => setEntityFilter(null)}>
              Showing one record&apos;s history <span aria-hidden="true">×</span>
              <span className="sr-only">(remove filter)</span>
            </button>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(entry) => entry.id}
        caption="Activity in your organization"
        loadingLabel="Loading activity…"
        emptyState={
          filtersActive ? (
            <>
              <p>No activity matches those filters.</p>
              <button type="button" className="btn btn-ghost btn-sm audit-reset" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <p>Nothing has happened yet. Changes to staff, properties and rooms will appear here.</p>
          )
        }
      />

      {pageMeta && (
        <Pagination
          page={pageMeta}
          onPageChange={setPage}
          itemLabel="entries"
          itemLabelSingular="entry"
          busy={refreshing}
        />
      )}

      {selected && (
        <AuditEntryDialog
          entry={selected}
          onClose={() => setSelected(null)}
          onFilterByActor={(actorUserId) => {
            setActorFilter(actorUserId);
            setEntityFilter(null);
            setSelected(null);
          }}
          onFilterByEntity={(entityId) => {
            setEntityFilter(entityId);
            setActorFilter(null);
            setSelected(null);
          }}
        />
      )}
    </section>
  );
}

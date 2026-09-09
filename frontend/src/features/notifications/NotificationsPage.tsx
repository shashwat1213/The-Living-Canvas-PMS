import { useCallback, useEffect, useState } from 'react';

import { hasPermission } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { listNotifications } from './api';
import { NotificationDialog } from './NotificationDialog';
import {
  CHANNEL_LABEL,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  type Notification,
} from './types';
import './notifications.css';

/** Relative time for recent rows, absolute for older ones — the log is
 * usually read right after something happened. */
function formatWhen(iso: string): { label: string; title: string } {
  const date = new Date(iso);
  const title = date.toLocaleString();
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return { label: iso, title: iso };
  if (seconds < 60) return { label: 'just now', title };
  if (seconds < 3600) return { label: `${Math.floor(seconds / 60)} min ago`, title };
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return { label: `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`, title };
  }
  return { label: date.toLocaleDateString(), title };
}

export function NotificationsPage() {
  const { session } = useAuth();

  const [items, setItems] = useState<Notification[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Notification | null>(null);

  // Presentation only. `notifications:read` is enforced on every request;
  // this just avoids rendering a page whose first call would be a 403.
  const mayRead = hasPermission(session, 'notifications:read');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await listNotifications({
        search: appliedSearch || undefined,
        channel: channelFilter === 'ALL' ? undefined : channelFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setItems(result.notifications);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setItems([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load notifications.');
    } finally {
      setRefreshing(false);
    }
  }, [appliedSearch, channelFilter, statusFilter, page]);

  // Debounce search: one request per pause, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any change to what's asked for resets to page 1.
  useEffect(() => {
    setPage(1);
  }, [appliedSearch, channelFilter, statusFilter]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  if (!mayRead) {
    return (
      <section className="notif-page">
        <h1>Notifications</h1>
        <p className="empty-state">
          You don&apos;t have access to the notification log. A manager or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<Notification>[] = [
    {
      key: 'when',
      header: 'When',
      render: (n) => {
        const when = formatWhen(n.createdAt);
        return (
          <time className="notif-when" dateTime={n.createdAt} title={when.title}>
            {when.label}
          </time>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (n) => <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>,
    },
    {
      key: 'channel',
      header: 'Channel',
      secondary: true,
      render: (n) => <span className="notif-channel">{CHANNEL_LABEL[n.channel]}</span>,
    },
    {
      key: 'recipient',
      header: 'To',
      render: (n) => <span className="notif-recipient">{n.recipient}</span>,
    },
    {
      key: 'subject',
      header: 'Subject',
      render: (n) => <span className="notif-subject">{n.subject || n.type}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Details</span>,
      align: 'end',
      render: (n) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(n)}>
          View
        </button>
      ),
    },
  ];

  const filtersActive = channelFilter !== 'ALL' || statusFilter !== 'ALL' || appliedSearch !== '';

  function clearFilters() {
    setSearch('');
    setChannelFilter('ALL');
    setStatusFilter('ALL');
  }

  return (
    <section className="notif-page">
      <header className="notif-header">
        <div>
          <h1>Notifications</h1>
          <p className="notif-subtitle">
            Every message your property has sent to guests and staff, newest first, with its delivery state.
          </p>
        </div>
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <div className="notif-filters">
        <div className="field notif-search">
          <label htmlFor="notif-search">Search</label>
          <input
            id="notif-search"
            type="search"
            placeholder="Recipient, subject or type…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="notif-channel-filter">Channel</label>
          <select
            id="notif-channel-filter"
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value)}
          >
            <option value="ALL">All channels</option>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {CHANNEL_LABEL[channel]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="notif-status-filter">Status</label>
          <select
            id="notif-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="ALL">All statuses</option>
            {NOTIFICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>

        {filtersActive && (
          <button type="button" className="btn btn-ghost btn-sm notif-reset" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(n) => n.id}
        caption="Notifications sent by your organization"
        loadingLabel="Loading notifications…"
        emptyState={
          filtersActive ? (
            <>
              <p>No notifications match those filters.</p>
              <button type="button" className="btn btn-ghost btn-sm notif-reset" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <p>No notifications yet. Guest messages — like booking confirmations — will appear here.</p>
          )
        }
      />

      {pageMeta && (
        <Pagination
          page={pageMeta}
          onPageChange={setPage}
          itemLabel="notifications"
          itemLabelSingular="notification"
          busy={refreshing}
        />
      )}

      {selected && <NotificationDialog notification={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

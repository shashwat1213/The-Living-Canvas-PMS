import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, type BadgeTone } from '../../components/Badge';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { formatMinorCompact } from '../rate-plans/money';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { getDashboard } from './api';
import { canReadDashboard } from './permissions';
import { addDays, todayUtc, type DashboardReservation, type DashboardView } from './types';
import './dashboard.css';

/** Front-desk labels for reservation statuses shown on the cockpit lists. */
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  CONFIRMED: 'positive',
  CHECKED_IN: 'accent',
  CHECKED_OUT: 'muted',
  CANCELLED: 'neutral',
  NO_SHOW: 'neutral',
};

/** A human date for the cockpit header, e.g. "Fri, 10 Oct 2026", in UTC. */
function headerDate(date: string): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function guestName(r: DashboardReservation): string {
  return `${r.guest.firstName} ${r.guest.lastName}`.trim();
}

/** One of the arrivals / departures / in-house guest lists. */
function GuestList({
  title,
  reservations,
  emptyLabel,
}: {
  title: string;
  reservations: DashboardReservation[];
  emptyLabel: string;
}) {
  return (
    <div className="cockpit-list">
      <header className="cockpit-list-head">
        <h2>{title}</h2>
        <span className="cockpit-list-count">{reservations.length}</span>
      </header>
      {reservations.length === 0 ? (
        <p className="cockpit-empty">{emptyLabel}</p>
      ) : (
        <ul className="cockpit-guest-rows">
          {reservations.map((r) => (
            <li key={r.id} className="cockpit-guest-row">
              <div className="cockpit-guest-main">
                <span className="cockpit-guest-name">{guestName(r)}</span>
                <span className="cockpit-guest-meta">
                  {r.reference} · {r.roomType.name}
                  {r.room ? ` · Room ${r.room.name}` : ''}
                </span>
              </div>
              <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A single headline metric card at the top of the cockpit. */
function Stat({
  value,
  label,
  tone,
  hint,
}: {
  value: string | number;
  label: string;
  tone?: 'default' | 'warn' | 'danger';
  hint?: string;
}) {
  return (
    <div className={`cockpit-stat cockpit-stat-${tone ?? 'default'}`}>
      <span className="cockpit-stat-value">{value}</span>
      <span className="cockpit-stat-label">{label}</span>
      {hint && <span className="cockpit-stat-hint">{hint}</span>}
    </div>
  );
}

/**
 * The property's operational dashboard — the front desk's daily cockpit.
 * Read-only, computed server-side for one calendar date (default today):
 * arrivals, departures, in-house guests, occupancy, housekeeping and
 * maintenance load, and folios still carrying a balance. All money is
 * formatted at the edge from integer paise; the client never does money math.
 */
export function PropertyDashboardPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const [date, setDate] = useState(todayUtc());
  const [property, setProperty] = useState<Property | null>(null);
  const [view, setView] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Presentation only — the route and API both enforce this themselves.
  const mayRead = canReadDashboard(session);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await getDashboard(propertyId, date);
      setView(result);
      setError(null);
    } catch (err) {
      setView(null);
      setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, date]);

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

  if (!mayRead) {
    return (
      <section className="cockpit-page">
        <h1>Dashboard</h1>
        <p className="empty-state">
          You don&apos;t have access to this property&apos;s dashboard. An owner or admin in your
          organization can grant it.
        </p>
      </section>
    );
  }

  const s = view?.summary;
  const isToday = date === todayUtc();

  return (
    <section className="cockpit-page">
      <p className="cockpit-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="cockpit-header">
        <div>
          <h1>Dashboard{property ? ` — ${property.name}` : ''}</h1>
          <p className="cockpit-subtitle">
            Today&apos;s operations at a glance — arrivals, departures, occupancy and open work.
          </p>
        </div>
        <div className="cockpit-datenav">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDate((d) => addDays(d, -1))}
            disabled={refreshing}
            aria-label="Previous day"
          >
            &larr;
          </button>
          <input
            type="date"
            className="cockpit-dateinput"
            value={date}
            onChange={(e) => setDate(e.target.value || todayUtc())}
            aria-label="Dashboard date"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDate((d) => addDays(d, 1))}
            disabled={refreshing}
            aria-label="Next day"
          >
            &rarr;
          </button>
          {!isToday && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDate(todayUtc())} disabled={refreshing}>
              Today
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {view && s ? (
        <>
          <p className="cockpit-forday" aria-live="polite">
            {headerDate(view.date)}
          </p>

          <div className="cockpit-stats">
            <Stat value={s.arrivals} label="Arrivals" />
            <Stat value={s.departures} label="Departures" />
            <Stat value={s.inHouse} label="In-house" />
            <Stat
              value={`${s.occupancyPct}%`}
              label="Occupancy"
              hint={`${s.occupiedRooms} of ${s.sellableRooms} rooms`}
            />
            <Stat
              value={s.roomsToClean}
              label="Rooms to clean"
              tone={s.roomsToClean > 0 ? 'warn' : 'default'}
              hint={`${view.housekeeping.openTasks} open task${view.housekeeping.openTasks === 1 ? '' : 's'}`}
            />
            <Stat
              value={s.openWorkOrders}
              label="Open work orders"
              tone={s.urgentWorkOrders > 0 ? 'danger' : s.openWorkOrders > 0 ? 'warn' : 'default'}
              hint={s.urgentWorkOrders > 0 ? `${s.urgentWorkOrders} urgent` : `${s.roomsOutOfService} out of service`}
            />
            <Stat
              value={s.unsettledFolios}
              label="Unsettled folios"
              tone={s.unsettledBalanceMinor > 0 ? 'warn' : 'default'}
              hint={s.unsettledBalanceMinor > 0 ? formatMinorCompact(s.unsettledBalanceMinor) : 'all settled'}
            />
          </div>

          <div className="cockpit-lists">
            <GuestList title="Arrivals" reservations={view.arrivals} emptyLabel="No arrivals for this day." />
            <GuestList title="Departures" reservations={view.departures} emptyLabel="No departures for this day." />
            <GuestList title="In-house" reservations={view.inHouse} emptyLabel="No guests in-house on this day." />
          </div>

          <div className="cockpit-panels">
            <div className="cockpit-panel">
              <header className="cockpit-list-head">
                <h2>Housekeeping</h2>
                <Link className="btn btn-ghost btn-sm" to={`/app/properties/${propertyId}/housekeeping`}>
                  Open board
                </Link>
              </header>
              <dl className="cockpit-breakdown">
                <div><dt>Dirty</dt><dd>{view.housekeeping.dirty}</dd></div>
                <div><dt>Cleaning</dt><dd>{view.housekeeping.cleaning}</dd></div>
                <div><dt>Clean</dt><dd>{view.housekeeping.clean}</dd></div>
                <div><dt>Inspected</dt><dd>{view.housekeeping.inspected}</dd></div>
                <div><dt>Open tasks</dt><dd>{view.housekeeping.openTasks}</dd></div>
              </dl>
            </div>

            <div className="cockpit-panel">
              <header className="cockpit-list-head">
                <h2>Maintenance</h2>
                <Link className="btn btn-ghost btn-sm" to={`/app/properties/${propertyId}/maintenance`}>
                  Work orders
                </Link>
              </header>
              <dl className="cockpit-breakdown">
                <div><dt>Open</dt><dd>{view.maintenance.open}</dd></div>
                <div><dt>Urgent</dt><dd>{view.maintenance.urgent}</dd></div>
                <div><dt>Rooms out of service</dt><dd>{view.maintenance.roomsOutOfService}</dd></div>
              </dl>
            </div>

            <div className="cockpit-panel cockpit-panel-wide">
              <header className="cockpit-list-head">
                <h2>Unsettled folios</h2>
                <span className="cockpit-list-count">{view.unsettledFolioList.length}</span>
              </header>
              {view.unsettledFolioList.length === 0 ? (
                <p className="cockpit-empty">No outstanding balances.</p>
              ) : (
                <ul className="cockpit-folio-rows">
                  {view.unsettledFolioList.map((f) => (
                    <li key={f.id} className="cockpit-folio-row">
                      <div className="cockpit-guest-main">
                        <span className="cockpit-guest-name">{f.guestName}</span>
                        <span className="cockpit-guest-meta">{f.reference}</span>
                      </div>
                      <span className="cockpit-folio-amount">{formatMinorCompact(f.balanceMinor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : (
        !error && <p className="empty-state">Loading dashboard…</p>
      )}
    </section>
  );
}

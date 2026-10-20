import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { hasPermission } from '../auth/session';
import { getDashboard } from '../features/dashboard/api';
import type { DashboardView } from '../features/dashboard/types';
import { listProperties } from '../features/properties/api';
import type { Property } from '../features/properties/types';
import { ApiError, apiFetch } from '../lib/api';
import './dashboard.css';

interface Organization {
  id: string;
  name: string;
}

interface PropertySnapshot {
  property: Property;
  view: DashboardView | null;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * Organization home: a portfolio overview across every property the caller
 * can see — today's arrivals, departures, in-house guests and occupancy,
 * aggregated from each property's real front-desk dashboard. Falls back to a
 * first-run empty state that points at the onboarding wizard.
 */
export function DashboardPage() {
  const { session } = useAuth();
  const mayReadDashboard = hasPermission(session, 'dashboard:read');
  const mayCreate = hasPermission(session, 'properties:create');
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [snapshots, setSnapshots] = useState<PropertySnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    document.title = 'Dashboard · The Living Canvas';
    let cancelled = false;
    setError(null);
    Promise.all([
      apiFetch<{ organization: Organization }>('/api/v1/organizations/me'),
      listProperties({ pageSize: 12, status: 'ACTIVE' }),
    ])
      .then(async ([orgRes, propsRes]) => {
        if (cancelled) return;
        setOrganization(orgRes.organization);
        const views = await Promise.all(
          propsRes.properties.map(async (property) => ({
            property,
            view: mayReadDashboard ? await getDashboard(property.id).catch(() => null) : null,
          })),
        );
        if (!cancelled) setSnapshots(views);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load your dashboard.');
      });
    return () => {
      cancelled = true;
    };
  }, [mayReadDashboard, nonce]);

  if (error) {
    return (
      <section className="dashboard">
        <div className="page-error" role="alert">
          {error}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNonce((n) => n + 1)}>
            Try again
          </button>
        </div>
      </section>
    );
  }

  if (organization === null || snapshots === null) {
    return (
      <section className="dashboard" aria-busy="true">
        <div className="skeleton skeleton-title" />
        <div className="dashboard-kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton skeleton-kpi" />
          ))}
        </div>
        <div className="skeleton skeleton-card" />
        <span className="sr-only" role="status">
          Loading dashboard…
        </span>
      </section>
    );
  }

  const totals = snapshots.reduce(
    (acc, s) => {
      if (!s.view) return acc;
      acc.arrivals += s.view.summary.arrivals;
      acc.departures += s.view.summary.departures;
      acc.inHouse += s.view.summary.inHouse;
      acc.sellable += s.view.summary.sellableRooms;
      acc.occupied += s.view.summary.occupiedRooms;
      acc.toClean += s.view.summary.roomsToClean;
      acc.balance += s.view.summary.unsettledBalanceMinor;
      return acc;
    },
    { arrivals: 0, departures: 0, inHouse: 0, sellable: 0, occupied: 0, toClean: 0, balance: 0 },
  );
  const occupancy = totals.sellable > 0 ? Math.round((totals.occupied / totals.sellable) * 100) : 0;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section className="dashboard">
      <header className="dashboard-head">
        <div>
          <p className="dashboard-date">{today}</p>
          <h1>
            {greeting()}, {organization.name}
          </h1>
          <p className="dashboard-sub">
            {snapshots.length === 0
              ? 'Your workspace is ready. Add a property to start taking bookings.'
              : `Here’s what’s happening across your ${snapshots.length === 1 ? 'property' : `${snapshots.length} properties`} today.`}
          </p>
        </div>
        <Link to="/app/properties" className="btn btn-secondary">
          All properties
        </Link>
      </header>

      {snapshots.length === 0 ? (
        <div className="dashboard-empty">
          <div className="dashboard-empty-art" aria-hidden="true">🏨</div>
          <h2>No properties yet</h2>
          <p>Set up your first property, room types, rates and rooms in about a minute with the guided setup.</p>
          {mayCreate ? (
            <Link to="/app/welcome" className="btn btn-primary">
              Start guided setup
            </Link>
          ) : (
            <p className="dashboard-sub">Ask an owner or admin to add a property for you.</p>
          )}
        </div>
      ) : (
        <>
          {mayReadDashboard && (
            <div className="dashboard-kpis">
              <Kpi label="Arrivals today" value={totals.arrivals} />
              <Kpi label="Departures today" value={totals.departures} />
              <Kpi label="In-house guests" value={totals.inHouse} />
              <Kpi label="Occupancy tonight" value={`${occupancy}%`} hint={`${totals.occupied} of ${totals.sellable} rooms`} />
            </div>
          )}

          <h2 className="dashboard-section-title">Properties</h2>
          <div className="dashboard-props">
            {snapshots.map(({ property, view }) => {
              const occ = view ? view.summary.occupancyPct : null;
              return (
                <article key={property.id} className="dashboard-prop">
                  <header>
                    <div>
                      <h3>{property.name}</h3>
                      <p>{[property.city, property.country].filter(Boolean).join(', ') || property.slug}</p>
                    </div>
                    {occ !== null && (
                      <span className="dashboard-occ" aria-label={`Occupancy ${occ}%`}>
                        <span className="dashboard-occ-bar" style={{ width: `${Math.min(occ, 100)}%` }} />
                        <span className="dashboard-occ-label">{occ}%</span>
                      </span>
                    )}
                  </header>
                  {view && (
                    <dl className="dashboard-prop-stats">
                      <div>
                        <dt>Arrivals</dt>
                        <dd>{view.summary.arrivals}</dd>
                      </div>
                      <div>
                        <dt>Departures</dt>
                        <dd>{view.summary.departures}</dd>
                      </div>
                      <div>
                        <dt>In house</dt>
                        <dd>{view.summary.inHouse}</dd>
                      </div>
                      <div>
                        <dt>To clean</dt>
                        <dd>{view.summary.roomsToClean}</dd>
                      </div>
                      <div>
                        <dt>Open balance</dt>
                        <dd>{inr.format(view.summary.unsettledBalanceMinor / 100)}</dd>
                      </div>
                    </dl>
                  )}
                  <footer>
                    {mayReadDashboard && (
                      <Link className="btn btn-primary btn-sm" to={`/app/properties/${property.id}/dashboard`}>
                        Front desk
                      </Link>
                    )}
                    <Link className="btn btn-ghost btn-sm" to={`/app/properties/${property.id}/calendar`}>
                      Calendar
                    </Link>
                    <Link className="btn btn-ghost btn-sm" to={`/app/properties/${property.id}/reservations`}>
                      Reservations
                    </Link>
                  </footer>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="dashboard-kpi">
      <span className="dashboard-kpi-label">{label}</span>
      <span className="dashboard-kpi-value">{value}</span>
      {hint && <span className="dashboard-kpi-hint">{hint}</span>}
    </div>
  );
}

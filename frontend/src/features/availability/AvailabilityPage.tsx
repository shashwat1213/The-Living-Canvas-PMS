import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { hasPermission } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { getAvailability } from './api';
import {
  DEFAULT_WINDOW_NIGHTS,
  addDays,
  todayUtc,
  type AvailabilityResponse,
} from './types';
import './availability.css';

/** A short header label for a night, e.g. "1 Thu", in UTC. */
function nightLabel(date: string): { day: string; weekday: string } {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return { day: date, weekday: '' };
  const d = new Date(ms);
  return {
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
  };
}

/** A human range for the current window, e.g. "1 Oct – 7 Oct 2026" (to is exclusive). */
function rangeLabel(from: string, to: string): string {
  const fmt = (date: string) => {
    const ms = Date.parse(`${date}T00:00:00.000Z`);
    if (Number.isNaN(ms)) return date;
    return new Date(ms).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  // `to` is exclusive, so the last night shown is the day before it.
  return `${fmt(from)} – ${fmt(addDays(to, -1))}`;
}

export function AvailabilityPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const initialFrom = todayUtc();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(addDays(initialFrom, DEFAULT_WINDOW_NIGHTS));

  const [property, setProperty] = useState<Property | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Presentation only — the route and API both enforce this themselves.
  const mayRead = hasPermission(session, 'reservations:read');

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await getAvailability(propertyId, from, to);
      setAvailability(result);
      setError(null);
    } catch (err) {
      setAvailability(null);
      setError(err instanceof ApiError ? err.message : 'Could not load availability.');
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, from, to]);

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

  function shiftWeek(direction: -1 | 1) {
    const span = DEFAULT_WINDOW_NIGHTS * direction;
    setFrom((current) => addDays(current, span));
    setTo((current) => addDays(current, span));
  }

  if (!mayRead) {
    return (
      <section className="availability-page">
        <h1>Availability</h1>
        <p className="empty-state">
          You don&apos;t have access to availability. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const dates = availability?.dates ?? [];
  const totalsByDate = new Map(availability?.totals.days.map((day) => [day.date, day]) ?? []);
  const hasRoomTypes = (availability?.roomTypes.length ?? 0) > 0;

  return (
    <section className="availability-page">
      <p className="availability-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="availability-header">
        <div>
          <h1>Availability{property ? ` — ${property.name}` : ''}</h1>
          <p className="availability-subtitle">
            Rooms free per type and night — sold-out days in red, open days in green.
          </p>
        </div>
        <div className="availability-nav">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => shiftWeek(-1)}
            disabled={refreshing}
          >
            &larr; Previous week
          </button>
          <span className="availability-range" aria-live="polite">
            {rangeLabel(from, to)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => shiftWeek(1)}
            disabled={refreshing}
          >
            Next week &rarr;
          </button>
        </div>
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {availability && !hasRoomTypes ? (
        <p className="empty-state">No active room types for this property yet.</p>
      ) : availability ? (
        <div className="availability-grid-wrap">
          <table className="availability-grid">
            <caption className="sr-only">Room availability by night for this property</caption>
            <thead>
              <tr>
                <th scope="col" className="availability-corner">
                  Room type
                </th>
                {dates.map((date) => {
                  const label = nightLabel(date);
                  return (
                    <th key={date} scope="col" className="availability-datecol">
                      <span className="availability-date-day">{label.day}</span>
                      <span className="availability-date-weekday">{label.weekday}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {availability.roomTypes.map((roomType) => (
                <tr key={roomType.id}>
                  <th scope="row" className="availability-rowhead">
                    <span className="availability-rt-name">{roomType.name}</span>
                    <span className="availability-rt-meta">
                      {roomType.code ? `${roomType.code} · ` : ''}
                      {roomType.totalRooms} room{roomType.totalRooms === 1 ? '' : 's'}
                    </span>
                  </th>
                  {roomType.days.map((day) => {
                    const soldOut = day.available <= 0;
                    return (
                      <td
                        key={day.date}
                        className={`availability-cell ${soldOut ? 'availability-cell-soldout' : 'availability-cell-open'}`}
                        title={`${day.available} of ${roomType.totalRooms} free`}
                      >
                        {day.available}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="availability-totals">
                <th scope="row" className="availability-rowhead">
                  <span className="availability-rt-name">Occupancy</span>
                  <span className="availability-rt-meta">across all room types</span>
                </th>
                {dates.map((date) => {
                  const total = totalsByDate.get(date);
                  const soldOut = total ? total.available <= 0 : false;
                  return (
                    <td
                      key={date}
                      className={`availability-cell availability-total-cell ${
                        soldOut ? 'availability-cell-soldout' : ''
                      }`}
                      title={total ? `${total.available} of ${total.totalRooms} free` : undefined}
                    >
                      <span className="availability-occ-pct">{total ? `${total.occupancyPct}%` : '—'}</span>
                      {total && (
                        <span className="availability-occ-meta">
                          {total.available}/{total.totalRooms}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        !error && <p className="empty-state">Loading availability…</p>
      )}
    </section>
  );
}

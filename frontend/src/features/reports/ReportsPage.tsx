import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { formatMinor, formatMinorCompact } from '../rate-plans/money';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { getRevenueReport } from './api';
import { canReadReports } from './permissions';
import {
  DEFAULT_REPORT_NIGHTS,
  PAYMENT_METHOD_LABEL,
  addDays,
  todayUtc,
  type RevenueReport,
} from './types';
import './reports.css';

/** A short header label for a night, e.g. "10 Fri", in UTC. */
function nightLabel(date: string): { day: string; weekday: string; month: string } {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return { day: date, weekday: '', month: '' };
  const d = new Date(ms);
  return {
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
  };
}

/** A human range for the current window, e.g. "11 Sep – 10 Oct 2026" (to exclusive). */
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
  // `to` is exclusive, so the last reported night is the day before it.
  return `${fmt(from)} – ${fmt(addDays(to, -1))}`;
}

/** A headline metric card. */
function Metric({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="report-metric">
      <span className="report-metric-value">{value}</span>
      <span className="report-metric-label">{label}</span>
      {hint && <span className="report-metric-hint">{hint}</span>}
    </div>
  );
}

/**
 * A property's revenue & occupancy report over a date range — the manager's
 * night-audit / flash view. Room revenue is accrual-based (earned per stay
 * night); payments collected is cash-based (when money was taken). All money
 * is formatted at the edge from integer paise; the client never does money
 * math — every figure here is computed server-side.
 */
export function ReportsPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  // Default: the last 30 nights ending today (today is included as a night, so
  // `to` is tomorrow — exclusive).
  const initialTo = addDays(todayUtc(), 1);
  const [from, setFrom] = useState(addDays(initialTo, -DEFAULT_REPORT_NIGHTS));
  const [to, setTo] = useState(initialTo);

  const [property, setProperty] = useState<Property | null>(null);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Presentation only — the route and API both enforce this themselves.
  const mayRead = canReadReports(session);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await getRevenueReport(propertyId, from, to);
      setReport(result);
      setError(null);
    } catch (err) {
      setReport(null);
      setError(err instanceof ApiError ? err.message : 'Could not load the report.');
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

  function shiftWindow(direction: -1 | 1) {
    const span = (report?.nights ?? DEFAULT_REPORT_NIGHTS) * direction;
    setFrom((current) => addDays(current, span));
    setTo((current) => addDays(current, span));
  }

  if (!mayRead) {
    return (
      <section className="reports-page">
        <h1>Reports</h1>
        <p className="empty-state">
          You don&apos;t have access to this property&apos;s reports. Reporting is available to
          managers, admins and owners.
        </p>
      </section>
    );
  }

  const s = report?.summary;

  return (
    <section className="reports-page">
      <p className="reports-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="reports-header">
        <div>
          <h1>Revenue &amp; occupancy{property ? ` — ${property.name}` : ''}</h1>
          <p className="reports-subtitle">
            Room revenue, occupancy, ADR and RevPAR by night, with payments collected.
          </p>
        </div>
        <div className="reports-nav">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWindow(-1)} disabled={refreshing}>
            &larr; Earlier
          </button>
          <span className="reports-range" aria-live="polite">
            {rangeLabel(from, to)}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWindow(1)} disabled={refreshing}>
            Later &rarr;
          </button>
        </div>
      </header>

      <div className="reports-daterow">
        <label>
          From
          <input type="date" value={from} max={addDays(to, -1)} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label>
          To (exclusive)
          <input type="date" value={to} min={addDays(from, 1)} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
      </div>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {report && s ? (
        <>
          <div className="reports-metrics">
            <Metric value={formatMinorCompact(s.roomRevenueMinor)} label="Room revenue" hint={`${report.nights} night${report.nights === 1 ? '' : 's'}`} />
            <Metric value={`${s.occupancyPct}%`} label="Occupancy" hint={`${s.roomsSold} of ${s.roomNightsAvailable} room-nights`} />
            <Metric value={formatMinorCompact(s.adrMinor)} label="ADR" hint="avg. daily rate" />
            <Metric value={formatMinorCompact(s.revparMinor)} label="RevPAR" hint="rev. per available room" />
            <Metric value={formatMinorCompact(s.paymentsCollectedMinor)} label="Payments collected" hint="cash basis" />
          </div>

          <div className="reports-body">
            <div className="reports-table-wrap">
              <table className="reports-table">
                <caption className="sr-only">Revenue and occupancy by night</caption>
                <thead>
                  <tr>
                    <th scope="col">Night</th>
                    <th scope="col" className="report-num">Sold</th>
                    <th scope="col" className="report-num">Occ.</th>
                    <th scope="col" className="report-num">ADR</th>
                    <th scope="col" className="report-num">RevPAR</th>
                    <th scope="col" className="report-num">Room revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => {
                    const l = nightLabel(d.date);
                    return (
                      <tr key={d.date}>
                        <th scope="row" className="report-night">
                          <span className="report-night-day">{l.day} {l.month}</span>
                          <span className="report-night-weekday">{l.weekday}</span>
                        </th>
                        <td className="report-num">{d.roomsSold}/{d.roomsAvailable}</td>
                        <td className="report-num">{d.occupancyPct}%</td>
                        <td className="report-num">{d.roomsSold > 0 ? formatMinor(d.adrMinor) : '—'}</td>
                        <td className="report-num">{formatMinor(d.revparMinor)}</td>
                        <td className="report-num report-revenue">{formatMinor(d.roomRevenueMinor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="reports-total">
                    <th scope="row">Total</th>
                    <td className="report-num">{s.roomsSold}/{s.roomNightsAvailable}</td>
                    <td className="report-num">{s.occupancyPct}%</td>
                    <td className="report-num">{s.roomsSold > 0 ? formatMinor(s.adrMinor) : '—'}</td>
                    <td className="report-num">{formatMinor(s.revparMinor)}</td>
                    <td className="report-num report-revenue">{formatMinor(s.roomRevenueMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <aside className="reports-payments">
              <h2>Payments collected</h2>
              <p className="reports-payments-sub">By method, over this window (cash basis).</p>
              {report.paymentsByMethod.length === 0 ? (
                <p className="empty-state">No payments recorded in this window.</p>
              ) : (
                <ul className="reports-payment-rows">
                  {report.paymentsByMethod.map((p) => (
                    <li key={p.method} className="reports-payment-row">
                      <div className="reports-payment-main">
                        <span className="reports-payment-method">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                        <span className="reports-payment-count">{p.count} payment{p.count === 1 ? '' : 's'}</span>
                      </div>
                      <span className="reports-payment-amount">{formatMinor(p.amountMinor)}</span>
                    </li>
                  ))}
                  <li className="reports-payment-row reports-payment-total">
                    <span className="reports-payment-method">Total</span>
                    <span className="reports-payment-amount">{formatMinor(s.paymentsCollectedMinor)}</span>
                  </li>
                </ul>
              )}
            </aside>
          </div>
        </>
      ) : (
        !error && <p className="empty-state">Loading report…</p>
      )}
    </section>
  );
}

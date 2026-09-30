import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ApiError } from '../../lib/api';
import { formatMinor, formatMinorCompact } from '../rate-plans/money';
import { getMonthlyAnalytics } from './api';
import type { MonthlyAnalytics } from './analytics-types';
import './analytics.css';

/** Brand-aligned chart palette (matches the app's deep-green + teal theme). */
const C = {
  room: '#0f766e',
  pos: '#2db5a8',
  net: '#0a4d47',
  refund: '#c0392b',
  occ: '#14a396',
  adr: '#b45309',
  grid: '#e7e2da',
  axis: '#9a958c',
};

const RANGE_OPTIONS = [
  { label: '6M', months: 6 },
  { label: '12M', months: 12 },
  { label: '24M', months: 24 },
];

/** ₹ in lakhs for compact axis ticks, e.g. 9924000 paise → "₹0.99L". */
function lakhTick(minor: number): string {
  const lakhs = minor / 100 / 100_000;
  return `₹${lakhs.toFixed(lakhs >= 10 ? 0 : 1)}L`;
}

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'up' | 'down';
}

function Kpi({ label, value, sub, tone = 'default' }: KpiProps) {
  return (
    <div className="an-kpi">
      <span className="an-kpi-label">{label}</span>
      <span className="an-kpi-value">{value}</span>
      {sub && <span className={`an-kpi-sub an-kpi-sub-${tone}`}>{sub}</span>}
    </div>
  );
}

/** Shared tooltip that renders every series as formatted rupees or a raw value. */
interface TooltipEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}
function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="an-tooltip">
      <div className="an-tooltip-title">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="an-tooltip-row">
          <span className="an-tooltip-dot" style={{ background: p.color }} />
          <span className="an-tooltip-name">{p.name}</span>
          <span className="an-tooltip-val">
            {p.dataKey === 'occupancyPct'
              ? `${p.value}%`
              : p.dataKey === 'roomsSold'
                ? `${p.value} nights`
                : formatMinor(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The dashboard's monthly performance analytics — revenue trend, occupancy vs
 * ADR, and revenue mix, all from real data. Deliberately labelled as revenue
 * analytics (not profit): the system tracks no expenses, so no cost/margin is
 * shown. Manager-gated upstream via `reports:read` (the endpoint 403s a viewer
 * without it, which this surfaces as an inline notice rather than a crash).
 */
export function AnalyticsSection({ propertyId }: { propertyId: string }) {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState<MonthlyAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    getMonthlyAnalytics(propertyId, months)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          setForbidden(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'Could not load analytics.');
        }
      });
    return () => {
      active = false;
    };
  }, [propertyId, months]);

  if (forbidden) {
    return (
      <section className="an-section">
        <header className="an-head">
          <h2>Performance analytics</h2>
        </header>
        <p className="an-empty">Analytics require the reports permission. An owner or admin can grant it.</p>
      </section>
    );
  }

  const s = data?.summary;
  const mix = s
    ? [
        { name: 'Rooms', value: s.roomRevenueMinor, color: C.room },
        { name: 'POS / F&B', value: s.posRevenueMinor, color: C.pos },
      ].filter((d) => d.value > 0)
    : [];

  const momTone = s?.revenueMomPct == null ? 'default' : s.revenueMomPct >= 0 ? 'up' : 'down';
  const momSub =
    s?.revenueMomPct == null ? 'vs last month' : `${s.revenueMomPct >= 0 ? '▲' : '▼'} ${Math.abs(s.revenueMomPct)}% vs last month`;

  return (
    <section className="an-section">
      <header className="an-head">
        <div>
          <h2>Performance analytics</h2>
          <p className="an-sub">Revenue, occupancy and yield — real figures from the booking &amp; folio ledger.</p>
        </div>
        <div className="an-range" role="group" aria-label="Time range">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.months}
              type="button"
              className={`an-range-btn ${months === o.months ? 'is-active' : ''}`}
              onClick={() => setMonths(o.months)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="an-error">{error}</p>}
      {!data && !error && <p className="an-loading">Loading analytics…</p>}

      {data && s && (
        <>
          {/* KPI strip */}
          <div className="an-kpis">
            <Kpi label="Gross revenue" value={formatMinorCompact(s.grossRevenueMinor)} sub={momSub} tone={momTone} />
            <Kpi label="Net collected" value={formatMinorCompact(s.netCollectedMinor)} sub={`${formatMinorCompact(s.refundsMinor)} refunded`} />
            <Kpi label="Occupancy" value={`${s.occupancyPct}%`} sub={`${data.sellableRooms} sellable rooms`} />
            <Kpi label="ADR" value={formatMinorCompact(s.adrMinor)} sub="avg. daily rate" />
            <Kpi label="RevPAR" value={formatMinorCompact(s.revparMinor)} sub="rev / avail. room" />
          </div>

          {/* Revenue trend */}
          <div className="an-card an-card-wide">
            <h3 className="an-card-title">Monthly revenue — rooms vs POS</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.months} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRoom" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.room} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.room} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.pos} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.pos} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis tickFormatter={lakhTick} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<MoneyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="roomRevenueMinor" name="Rooms" stackId="1" stroke={C.room} strokeWidth={2} fill="url(#gRoom)" />
                <Area type="monotone" dataKey="posRevenueMinor" name="POS / F&B" stackId="1" stroke={C.pos} strokeWidth={2} fill="url(#gPos)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="an-grid">
            {/* Occupancy vs ADR */}
            <div className="an-card">
              <h3 className="an-card-title">Occupancy &amp; ADR</h3>
              <ResponsiveContainer width="100%" height={230}>
                <ComposedChart data={data.months} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                  <YAxis yAxisId="l" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} width={36} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={lakhTick} tick={{ fontSize: 10, fill: C.axis }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="occupancyPct" name="Occupancy" fill={C.occ} radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Line yAxisId="r" type="monotone" dataKey="adrMinor" name="ADR" stroke={C.adr} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Revenue mix */}
            <div className="an-card">
              <h3 className="an-card-title">Revenue mix</h3>
              {mix.length === 0 ? (
                <p className="an-empty">No revenue in this window yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={mix} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} strokeWidth={0}>
                      {mix.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<MoneyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Collections vs refunds */}
          <div className="an-card an-card-wide">
            <h3 className="an-card-title">Collections vs refunds (cash basis)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.months} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis tickFormatter={lakhTick} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} width={48} />
                <Tooltip content={<MoneyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="paymentsCollectedMinor" name="Collected" fill={C.net} radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Bar dataKey="refundsMinor" name="Refunds" fill={C.refund} radius={[3, 3, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}

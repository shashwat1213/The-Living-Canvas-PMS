import { useCallback, useEffect, useMemo, useState } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { listRates, setRates } from './api';
import { formatMinorCompact, minorToRupeesInput, parseRupeesToMinor } from './money';
import type { RatePlan, RateEdit } from './types';

interface RateCalendarProps {
  propertyId: string;
  roomTypeId: string;
  ratePlan: RatePlan;
  /** Presentation-only: hides the editing controls when false. */
  mayManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** A month key, e.g. "2026-10". */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The per-night pricing calendar — the screen a revenue manager actually
 * lives in. One month at a time (matching how rates are reasoned about), each
 * day an editable rupee input. Edits are staged locally and committed in one
 * bulk `PUT` so a whole month reprices in a single request and a single audit
 * entry, exactly as the API is built for. An empty cell means "unpriced" — a
 * night that can't be sold on this plan until a price is set.
 */
export function RateCalendar({ propertyId, roomTypeId, ratePlan, mayManage, onClose, onSaved }: RateCalendarProps) {
  const [month, setMonth] = useState<Date>(() => firstOfMonth(new Date()));
  // Persisted rates for the visible month, keyed by ISO date → paise.
  const [saved, setSaved] = useState<Record<string, number>>({});
  // Staged edits (dirty), keyed by ISO date → rupee input string ('' = cleared).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkValue, setBulkValue] = useState('');

  const days = useMemo(() => {
    const start = firstOfMonth(month);
    const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    return Array.from({ length: daysInMonth }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), i + 1)));
  }, [month]);

  // Monday-based leading blanks so the grid aligns to weekday columns.
  const leadingBlanks = useMemo(() => {
    const jsDay = firstOfMonth(month).getUTCDay(); // 0=Sun..6=Sat
    return (jsDay + 6) % 7; // 0=Mon..6=Sun
  }, [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = isoDate(firstOfMonth(month));
      const to = isoDate(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)));
      const result = await listRates(propertyId, roomTypeId, ratePlan.id, from, to);
      const map: Record<string, number> = {};
      for (const r of result.rates) map[r.date] = r.amountMinor;
      setSaved(map);
      setDrafts({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load rates for this month.');
    } finally {
      setLoading(false);
    }
  }, [propertyId, roomTypeId, ratePlan.id, month]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The effective displayed value for a date: a staged draft wins over saved. */
  function displayValue(date: string): string {
    if (date in drafts) return drafts[date] ?? '';
    return date in saved ? minorToRupeesInput(saved[date] as number) : '';
  }

  function isDirty(date: string): boolean {
    if (!(date in drafts)) return false;
    const draft = (drafts[date] ?? '').trim();
    const savedVal = date in saved ? minorToRupeesInput(saved[date] as number) : '';
    return draft !== savedVal;
  }

  function setDraft(date: string, value: string) {
    setDrafts((current) => ({ ...current, [date]: value }));
  }

  function applyBulkToMonth() {
    const value = bulkValue.trim();
    if (value !== '' && parseRupeesToMinor(value) === null) {
      setError('Enter a valid amount to apply, or leave it blank to clear the month.');
      return;
    }
    setError(null);
    const next: Record<string, string> = { ...drafts };
    for (const d of days) next[isoDate(d)] = value;
    setDrafts(next);
  }

  const dirtyDates = useMemo(() => {
    return Object.keys(drafts).filter((date) => {
      const draft = (drafts[date] ?? '').trim();
      const savedVal = date in saved ? minorToRupeesInput(saved[date] as number) : '';
      return draft !== savedVal;
    });
  }, [drafts, saved]);

  async function handleSave() {
    if (dirtyDates.length === 0) return;
    const edits: RateEdit[] = [];
    const invalid: string[] = [];
    for (const date of dirtyDates) {
      const raw = (drafts[date] ?? '').trim();
      if (raw === '') {
        edits.push({ date, amountMinor: null });
        continue;
      }
      const minor = parseRupeesToMinor(raw);
      if (minor === null) {
        invalid.push(date);
        continue;
      }
      edits.push({ date, amountMinor: minor });
    }
    if (invalid.length > 0) {
      setError(`Some prices aren't valid amounts: ${invalid.join(', ')}. Fix or clear them before saving.`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await setRates(propertyId, roomTypeId, ratePlan.id, edits);
      await load();
      onSaved(
        `${ratePlan.name}: ${result.set} night${result.set === 1 ? '' : 's'} priced` +
          (result.cleared > 0 ? `, ${result.cleared} cleared.` : '.'),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save these rates.');
    } finally {
      setSaving(false);
    }
  }

  const dirtyCount = dirtyDates.length;

  return (
    <Modal
      title={`Rates — ${ratePlan.name}`}
      description="Set the nightly price for each date. An empty night is not sellable on this plan."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
          {mayManage && (
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving || dirtyCount === 0}>
              {saving ? 'Saving…' : dirtyCount === 0 ? 'No changes' : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
    >
      <div className="rate-calendar">
        <div className="rate-calendar-toolbar">
          <div className="rate-calendar-nav">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, -1))} disabled={saving}>
              &larr;
            </button>
            <span className="rate-calendar-month">
              {MONTH_NAMES[month.getUTCMonth()]} {month.getUTCFullYear()}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(addMonths(month, 1))} disabled={saving}>
              &rarr;
            </button>
          </div>

          {mayManage && (
            <div className="rate-calendar-bulk">
              <label htmlFor="rate-bulk">Apply to whole month</label>
              <input
                id="rate-bulk"
                type="text"
                inputMode="decimal"
                placeholder="₹ per night"
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
                disabled={saving}
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={applyBulkToMonth} disabled={saving}>
                Apply
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p className="rate-calendar-loading">Loading rates…</p>
        ) : (
          <div className="rate-calendar-grid" role="grid" aria-label={`${monthKey(month)} rates`}>
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="rate-calendar-weekday" role="columnheader">
                {label}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div key={`blank-${i}`} className="rate-calendar-cell rate-calendar-cell-empty" aria-hidden="true" />
            ))}
            {days.map((d) => {
              const date = isoDate(d);
              const dirty = isDirty(date);
              return (
                <div key={date} className={`rate-calendar-cell${dirty ? ' rate-calendar-cell-dirty' : ''}`} role="gridcell">
                  <span className="rate-calendar-daynum">{d.getUTCDate()}</span>
                  {mayManage ? (
                    <input
                      className="rate-calendar-input"
                      type="text"
                      inputMode="decimal"
                      aria-label={`Price for ${date}`}
                      placeholder="—"
                      value={displayValue(date)}
                      onChange={(event) => setDraft(date, event.target.value)}
                      disabled={saving}
                    />
                  ) : (
                    <span className="rate-calendar-readonly">
                      {date in saved ? formatMinorCompact(saved[date] as number) : '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

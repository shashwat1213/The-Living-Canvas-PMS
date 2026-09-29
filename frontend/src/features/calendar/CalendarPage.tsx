import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { hasPermission } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { getCalendar } from './api';
import { assignRoom, listAssignableRooms } from '../reservations/api';
import type { AssignableRoom } from '../reservations/types';
import {
  DEFAULT_WINDOW_NIGHTS,
  addDays,
  todayUtc,
  type CalendarBlock,
  type CalendarResponse,
  type CalendarRoom,
} from './types';
import './calendar.css';

/** A short header label for a night, e.g. { day: "1", weekday: "Thu" }, in UTC. */
function nightLabel(date: string): { day: string; weekday: string; isWeekend: boolean } {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return { day: date, weekday: '', isWeekend: false };
  const d = new Date(ms);
  const dow = d.getUTCDay();
  return {
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    isWeekend: dow === 0 || dow === 6,
  };
}

/** A human range for the current window, e.g. "1 Oct – 14 Oct 2026" (to is exclusive). */
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
  return `${fmt(from)} – ${fmt(addDays(to, -1))}`;
}

const STATUS_LABEL: Record<CalendarBlock['status'], string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'In-house',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

const HK_LABEL: Record<CalendarRoom['housekeepingStatus'], string> = {
  DIRTY: 'Dirty',
  CLEANING: 'Cleaning',
  CLEAN: 'Clean',
  INSPECTED: 'Inspected',
};

/** A single reservation bar, positioned by grid column. */
function ReservationBar({
  block,
  onSelect,
  interactive,
  draggable = false,
  onDragStart,
  onDragEnd,
  isDragging = false,
}: {
  block: CalendarBlock;
  onSelect?: (block: CalendarBlock) => void;
  interactive: boolean;
  draggable?: boolean;
  onDragStart?: (block: CalendarBlock) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const guests = block.adults + block.children;
  const title =
    `${block.guestName} · ${block.reference}\n` +
    `${block.checkIn} → ${block.checkOut} · ${guests} guest${guests === 1 ? '' : 's'} · ${STATUS_LABEL[block.status]}` +
    (draggable ? '\nDrag to a room row to (re)assign' : '');
  const style = {
    // Bars live inside `.cal-lane-track`, a grid of only the night columns
    // (no room-name column), so columns are 1-based on the nights directly.
    gridColumnStart: block.startIndex + 1,
    gridColumnEnd: `span ${block.span}`,
  };
  const className =
    `cal-bar cal-bar-${block.status.toLowerCase()}` +
    (block.continuesBefore ? ' cal-bar-open-start' : '') +
    (block.continuesAfter ? ' cal-bar-open-end' : '') +
    (draggable ? ' cal-bar-draggable' : '') +
    (isDragging ? ' cal-bar-dragging' : '');

  if (interactive && onSelect) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        title={title}
        onClick={() => onSelect(block)}
        draggable={draggable}
        onDragStart={
          draggable && onDragStart
            ? (e) => {
                // A payload marks this as an internal reservation drag.
                e.dataTransfer.setData('text/plain', block.id);
                e.dataTransfer.effectAllowed = 'move';
                onDragStart(block);
              }
            : undefined
        }
        onDragEnd={draggable ? onDragEnd : undefined}
      >
        <span className="cal-bar-label">
          {block.continuesBefore && <span aria-hidden="true">‹ </span>}
          {block.guestName}
          {block.continuesAfter && <span aria-hidden="true"> ›</span>}
        </span>
        <span className="cal-bar-ref">{block.reference}</span>
      </button>
    );
  }
  return (
    <div className={className} style={style} title={title}>
      <span className="cal-bar-label">{block.guestName}</span>
      <span className="cal-bar-ref">{block.reference}</span>
    </div>
  );
}

export function CalendarPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const initialFrom = todayUtc();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(addDays(initialFrom, DEFAULT_WINDOW_NIGHTS));

  const [property, setProperty] = useState<Property | null>(null);
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<CalendarBlock | null>(null);

  // Drag-to-(re)assign state. `dragBlock` is the reservation being dragged;
  // `dropRoomId` is the room lane currently hovered (for a highlight); `toast`
  // surfaces the outcome of a drop.
  const [dragBlock, setDragBlock] = useState<CalendarBlock | null>(null);
  const [dropRoomId, setDropRoomId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Presentation only — the route and API both enforce this themselves.
  const mayRead = hasPermission(session, 'reservations:read');
  const mayManage = hasPermission(session, 'reservations:manage');

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await getCalendar(propertyId, from, to);
      setCalendar(result);
      setError(null);
    } catch (err) {
      setCalendar(null);
      setError(err instanceof ApiError ? err.message : 'Could not load the calendar.');
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
    const span = DEFAULT_WINDOW_NIGHTS * direction;
    setFrom((current) => addDays(current, span));
    setTo((current) => addDays(current, span));
  }

  function goToday() {
    const today = todayUtc();
    setFrom(today);
    setTo(addDays(today, DEFAULT_WINDOW_NIGHTS));
  }

  /**
   * Drop a dragged reservation onto a room row → (re)assign it. Room-type
   * mismatch and no-op (same room) are caught client-side for instant
   * feedback; everything else (occupied, out of service, race) is enforced by
   * the assign-room endpoint and surfaced from its error. On success the board
   * refetches so the bar lands on its new room.
   */
  async function handleDropOnRoom(roomId: string, roomTypeId: string, roomName: string) {
    const block = dragBlock;
    setDragBlock(null);
    setDropRoomId(null);
    if (!block || !propertyId) return;

    if (block.roomId === roomId) return; // dropped where it already is
    if (block.roomTypeId !== roomTypeId) {
      setToast({ kind: 'error', message: `${block.guestName} is a different room type than ${roomName}.` });
      return;
    }

    try {
      await assignRoom(propertyId, block.id, roomId);
      setToast({ kind: 'success', message: `${block.guestName} → room ${roomName}.` });
      await load();
    } catch (err) {
      setToast({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reassign the booking.',
      });
    }
  }

  // Auto-dismiss the toast so it doesn't linger.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const dates = calendar?.dates ?? [];
  // The outer grid template: a fixed room-name column plus one equal column per night.
  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: `var(--cal-room-col) repeat(${dates.length}, minmax(var(--cal-night-col), 1fr))` }),
    [dates.length],
  );
  // Each lane's inner track holds only the night columns (bars position here).
  const trackStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${dates.length}, minmax(var(--cal-night-col), 1fr))` }),
    [dates.length],
  );

  if (!mayRead) {
    return (
      <section className="calendar-page">
        <h1>Reservation calendar</h1>
        <p className="empty-state">
          You don&apos;t have access to reservations. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const hasRooms = (calendar?.roomTypes.some((rt) => rt.rooms.length > 0)) ?? false;
  const unassigned = calendar?.unassigned ?? [];

  return (
    <section className="calendar-page">
      <p className="calendar-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="calendar-header">
        <div>
          <h1>Reservation calendar{property ? ` — ${property.name}` : ''}</h1>
          <p className="calendar-subtitle">
            Every room, every night. Bars are stays{mayManage ? ' — drag one onto another room to reassign' : ''}.
          </p>
        </div>
        <div className="calendar-controls">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWindow(-1)} disabled={refreshing}>
            &larr; Back
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={goToday} disabled={refreshing}>
            Today
          </button>
          <span className="calendar-range" aria-live="polite">
            {rangeLabel(from, to)}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftWindow(1)} disabled={refreshing}>
            Forward &rarr;
          </button>
        </div>
      </header>

      <div className="calendar-legend" aria-hidden="true">
        <span className="cal-legend-item"><span className="cal-swatch cal-bar-confirmed" /> Confirmed</span>
        <span className="cal-legend-item"><span className="cal-swatch cal-bar-checked_in" /> In-house</span>
        <span className="cal-legend-item"><span className="cal-swatch cal-bar-checked_out" /> Checked out</span>
        <span className="cal-legend-item"><span className="cal-swatch cal-swatch-oos" /> Out of service</span>
      </div>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {calendar && !hasRooms ? (
        <p className="empty-state">
          No rooms for this property yet. Add rooms under <Link to={`/app/properties/${propertyId}/rooms`}>Rooms</Link>{' '}
          to see them on the board.
        </p>
      ) : calendar ? (
        <div className="calendar-grid-wrap">
          <div className="calendar-grid" style={gridStyle} role="grid" aria-label="Reservation calendar">
            {/* Header row: corner + one cell per night. */}
            <div className="cal-corner" role="columnheader">
              Room
            </div>
            {dates.map((date) => {
              const label = nightLabel(date);
              return (
                <div
                  key={date}
                  className={`cal-datecol${label.isWeekend ? ' cal-datecol-weekend' : ''}`}
                  role="columnheader"
                >
                  <span className="cal-date-weekday">{label.weekday}</span>
                  <span className="cal-date-day">{label.day}</span>
                </div>
              );
            })}

            {/* Unassigned lane: bookings awaiting a room — the front desk's work list. */}
            {unassigned.length > 0 && (
              <>
                <div className="cal-rowhead cal-rowhead-unassigned" role="rowheader">
                  <span className="cal-room-name">Unassigned</span>
                  <span className="cal-room-meta">{unassigned.length} awaiting a room</span>
                </div>
                <div className="cal-lane cal-lane-unassigned" style={{ gridColumn: `2 / span ${dates.length}` }}>
                  <div className="cal-lane-track" style={trackStyle}>
                    {unassigned.map((block) => (
                      <ReservationBar
                        key={block.id}
                        block={block}
                        onSelect={setSelected}
                        interactive={mayManage}
                        draggable={mayManage}
                        onDragStart={setDragBlock}
                        onDragEnd={() => {
                          setDragBlock(null);
                          setDropRoomId(null);
                        }}
                        isDragging={dragBlock?.id === block.id}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* One group per room type, then one lane row per room. */}
            {calendar.roomTypes.map((rt) => (
              <div className="cal-group-contents" key={rt.id} role="rowgroup">
                <div className="cal-group-head" style={{ gridColumn: `1 / span ${dates.length + 1}` }}>
                  {rt.name}
                  {rt.code ? <span className="cal-group-code">{rt.code}</span> : null}
                  <span className="cal-group-count">
                    {rt.rooms.length} room{rt.rooms.length === 1 ? '' : 's'}
                  </span>
                </div>
                {rt.rooms.map((room) => {
                  const outOfService = room.status !== 'ACTIVE';
                  const blocks = calendar.assigned[room.id] ?? [];
                  // A room is a valid drop target while dragging a booking of
                  // its own type, unless it's out of service.
                  const canDrop =
                    !!dragBlock && !outOfService && dragBlock.roomTypeId === rt.id && dragBlock.roomId !== room.id;
                  const isDropTarget = canDrop && dropRoomId === room.id;
                  return (
                    <div className="cal-group-contents" key={room.id} role="row">
                      <div className={`cal-rowhead${outOfService ? ' cal-rowhead-oos' : ''}`} role="rowheader">
                        <span className="cal-room-name">{room.name}</span>
                        <span className="cal-room-meta">
                          {room.floor ? `Floor ${room.floor} · ` : ''}
                          {outOfService ? (room.status === 'MAINTENANCE' ? 'Maintenance' : 'Inactive') : HK_LABEL[room.housekeepingStatus]}
                        </span>
                      </div>
                      <div
                        className={
                          `cal-lane${outOfService ? ' cal-lane-oos' : ''}` +
                          (canDrop ? ' cal-lane-droppable' : '') +
                          (isDropTarget ? ' cal-lane-dropover' : '')
                        }
                        style={{ gridColumn: `2 / span ${dates.length}` }}
                        onDragOver={
                          canDrop
                            ? (e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dropRoomId !== room.id) setDropRoomId(room.id);
                              }
                            : undefined
                        }
                        onDragLeave={
                          canDrop
                            ? (e) => {
                                // Only clear when leaving the lane itself, not a child.
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                  setDropRoomId((cur) => (cur === room.id ? null : cur));
                                }
                              }
                            : undefined
                        }
                        onDrop={
                          canDrop
                            ? (e) => {
                                e.preventDefault();
                                void handleDropOnRoom(room.id, rt.id, room.name);
                              }
                            : undefined
                        }
                      >
                        <div className="cal-lane-track" style={trackStyle}>
                          {blocks.map((block) => (
                            <ReservationBar
                              key={block.id}
                              block={block}
                              onSelect={setSelected}
                              interactive={mayManage}
                              draggable={mayManage}
                              onDragStart={setDragBlock}
                              onDragEnd={() => {
                                setDragBlock(null);
                                setDropRoomId(null);
                              }}
                              isDragging={dragBlock?.id === block.id}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        !error && <p className="empty-state">Loading the calendar…</p>
      )}

      {toast && (
        <div className={`cal-toast cal-toast-${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}

      {selected && (
        <BlockDetails
          block={selected}
          propertyId={propertyId ?? ''}
          canManage={mayManage}
          onClose={() => setSelected(null)}
          onAssigned={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/** A detail popover for a selected reservation bar — with room assignment for
 * an unassigned booking when the viewer may manage reservations. */
function BlockDetails({
  block,
  propertyId,
  canManage,
  onClose,
  onAssigned,
}: {
  block: CalendarBlock;
  propertyId: string;
  canManage: boolean;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const guests = block.adults + block.children;
  const needsRoom = !block.roomId;

  const [assigning, setAssigning] = useState(false);
  const [rooms, setRooms] = useState<AssignableRoom[] | null>(null);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startAssign() {
    setAssigning(true);
    setLoadingRooms(true);
    setErr(null);
    try {
      const list = await listAssignableRooms(propertyId, block.id);
      setRooms(list);
      const firstFree = list.find((r) => r.available);
      if (firstFree) setRoomId(firstFree.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load rooms.');
    } finally {
      setLoadingRooms(false);
    }
  }

  async function confirmAssign() {
    if (!roomId) return;
    setBusy(true);
    setErr(null);
    try {
      await assignRoom(propertyId, block.id, roomId);
      onAssigned();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not assign the room.');
      setBusy(false);
    }
  }

  return (
    <div className="cal-detail-backdrop" role="dialog" aria-modal="true" aria-label="Reservation details" onClick={onClose}>
      <div className="cal-detail" onClick={(e) => e.stopPropagation()}>
        <header className="cal-detail-head">
          <h2>{block.guestName}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <dl className="cal-detail-body">
          <div><dt>Reference</dt><dd>{block.reference}</dd></div>
          <div><dt>Status</dt><dd>{STATUS_LABEL[block.status]}</dd></div>
          <div><dt>Stay</dt><dd>{block.checkIn} → {block.checkOut}</dd></div>
          <div><dt>Guests</dt><dd>{block.adults} adult{block.adults === 1 ? '' : 's'}{block.children > 0 ? `, ${block.children} child${block.children === 1 ? '' : 'ren'}` : ''} ({guests} total)</dd></div>
          <div><dt>Room</dt><dd>{block.roomId ? 'Assigned' : 'Not yet assigned'}</dd></div>
        </dl>

        {err && <p className="page-error" role="alert">{err}</p>}

        {/* Assign a room straight from the board — the front desk's core action
            on an unassigned booking. Only offered to a manager and only while
            the booking has no room. */}
        {needsRoom && canManage && !assigning && (
          <div className="cal-detail-assign">
            <button type="button" className="btn btn-primary btn-sm" onClick={startAssign}>
              Assign a room
            </button>
          </div>
        )}
        {needsRoom && canManage && assigning && (
          <div className="cal-detail-assign">
            {loadingRooms ? (
              <p className="cal-detail-hint">Loading rooms…</p>
            ) : rooms && rooms.length > 0 ? (
              <>
                <label className="cal-detail-label" htmlFor="cal-assign-room">
                  Room for this stay
                </label>
                <select
                  id="cal-assign-room"
                  className="cal-detail-select"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  disabled={busy}
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id} disabled={!r.available}>
                      {r.name}
                      {r.floor ? ` · Floor ${r.floor}` : ''}
                      {r.available ? '' : ' (occupied)'}
                    </option>
                  ))}
                </select>
                <div className="cal-detail-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssigning(false)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={confirmAssign} disabled={busy || !roomId}>
                    {busy ? 'Assigning…' : 'Confirm'}
                  </button>
                </div>
              </>
            ) : (
              <p className="cal-detail-hint">No rooms of this type are free for these dates.</p>
            )}
          </div>
        )}

        <footer className="cal-detail-foot">
          <Link className="btn btn-secondary btn-sm" to={`/app/properties/${propertyId}/reservations`}>
            Open in Reservations
          </Link>
        </footer>
      </div>
    </div>
  );
}

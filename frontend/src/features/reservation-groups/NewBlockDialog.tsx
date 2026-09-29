import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { listGuests } from '../guests/api';
import type { Guest } from '../guests/types';
import { guestFullName } from '../guests/types';
import { listRatePlans } from '../rate-plans/api';
import type { RatePlan } from '../rate-plans/types';
import { listRoomTypes } from '../room-types/api';
import type { RoomType } from '../room-types/types';
import { createReservationGroup } from './api';
import type { BlockRoomInput, ReservationGroupDetail } from './types';

interface NewBlockDialogProps {
  propertyId: string;
  onClose: () => void;
  onCreated: (group: ReservationGroupDetail) => void;
}

interface RoomLineState {
  key: string;
  roomTypeId: string;
  ratePlanId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
  adults: string;
  children: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function newLine(defaults: Partial<RoomLineState> = {}): RoomLineState {
  return {
    key: crypto.randomUUID(),
    roomTypeId: '',
    ratePlanId: '',
    guestId: '',
    checkIn: '',
    checkOut: '',
    adults: '1',
    children: '0',
    ...defaults,
  };
}

function nights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Create a block / group booking: a named block plus one-or-more rooms booked
 * together. Each room line is an ordinary booking (room type, rate plan, guest,
 * dates); the server prices and availability-checks the whole block atomically,
 * so if any line can't be placed nothing is created. Rooms may differ in type,
 * plan, guest and dates — a wedding books several Deluxe rooms for the weekend
 * and a Suite for the couple across a longer stay, all under one block.
 */
export function NewBlockDialog({ propertyId, onClose, onCreated }: NewBlockDialogProps) {
  const [name, setName] = useState('');
  const [contactGuestId, setContactGuestId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<RoomLineState[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [guests, setGuests] = useState<Guest[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  // Rate plans are loaded per room type, cached by type id.
  const [ratePlansByType, setRatePlansByType] = useState<Record<string, RatePlan[]>>({});

  useEffect(() => {
    listGuests({ pageSize: 100 })
      .then((res) => setGuests(res.guests))
      .catch(() => setGuests([]));
    listRoomTypes(propertyId, { status: 'ACTIVE', pageSize: 100 })
      .then((res) => setRoomTypes(res.roomTypes))
      .catch(() => setRoomTypes([]));
  }, [propertyId]);

  function ensureRatePlans(roomTypeId: string) {
    if (!roomTypeId || ratePlansByType[roomTypeId]) return;
    listRatePlans(propertyId, roomTypeId, { status: 'ACTIVE', pageSize: 100 })
      .then((res) => setRatePlansByType((cur) => ({ ...cur, [roomTypeId]: res.ratePlans })))
      .catch(() => setRatePlansByType((cur) => ({ ...cur, [roomTypeId]: [] })));
  }

  function updateLine(key: string, patch: Partial<RoomLineState>) {
    setLines((cur) =>
      cur.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // Changing the room type invalidates the chosen plan.
        if (patch.roomTypeId !== undefined && patch.roomTypeId !== l.roomTypeId) {
          next.ratePlanId = '';
          ensureRatePlans(patch.roomTypeId);
        }
        return next;
      }),
    );
  }

  function addLine() {
    // Copy the previous line's dates — a block usually shares a window.
    const prev = lines[lines.length - 1];
    setLines((cur) => [...cur, newLine({ checkIn: prev?.checkIn, checkOut: prev?.checkOut })]);
  }

  function removeLine(key: string) {
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((l) => l.key !== key)));
  }

  const roomCount = lines.length;

  const canSubmit = useMemo(() => {
    if (name.trim() === '') return false;
    return lines.every(
      (l) => l.roomTypeId && l.ratePlanId && l.guestId && l.checkIn && l.checkOut && nights(l.checkIn, l.checkOut) > 0,
    );
  }, [name, lines]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!canSubmit) {
      setError('Give the block a name and complete every room line.');
      return;
    }
    setSaving(true);
    try {
      const rooms: BlockRoomInput[] = lines.map((l) => ({
        roomTypeId: l.roomTypeId,
        ratePlanId: l.ratePlanId,
        guestId: l.guestId,
        checkIn: l.checkIn,
        checkOut: l.checkOut,
        adults: Number(l.adults) || 1,
        children: Number(l.children) || 0,
      }));
      const group = await createReservationGroup(propertyId, {
        name: name.trim(),
        contactGuestId: contactGuestId || undefined,
        notes: notes.trim() || undefined,
        rooms,
      });
      onCreated(group);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this block.');
    } finally {
      setSaving(false);
    }
  }

  const noRoomTypes = roomTypes.length === 0;
  const noGuests = guests.length === 0;

  return (
    <Modal
      title="New block booking"
      description="Book several rooms together under one name — a wedding, a corporate block, a tour group."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="block-form" className="btn btn-primary" disabled={saving || !canSubmit}>
            {saving ? 'Creating…' : `Create block (${roomCount} room${roomCount === 1 ? '' : 's'})`}
          </button>
        </>
      }
    >
      <form id="block-form" className="block-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}
        {noRoomTypes && (
          <p className="booking-notice">
            This property has no active room types. Set up the catalogue and rate plans before booking a block.
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="block-name">Block name</label>
            <input
              id="block-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="Sharma Wedding, Acme Corp offsite…"
            />
          </div>
          <div className="field">
            <label htmlFor="block-contact">Contact guest (optional)</label>
            <select
              id="block-contact"
              value={contactGuestId}
              onChange={(e) => setContactGuestId(e.target.value)}
              disabled={saving || noGuests}
            >
              <option value="">No contact</option>
              {guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {guestFullName(g)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="block-notes">Notes</label>
          <textarea
            id="block-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={saving}
            placeholder="Billing arrangement, arrival coordination…"
          />
        </div>

        <div className="block-rooms">
          <div className="block-rooms-head">
            <h3>Rooms in this block</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addLine} disabled={saving || noRoomTypes}>
              + Add room
            </button>
          </div>

          {lines.map((line, index) => {
            const plans = ratePlansByType[line.roomTypeId] ?? [];
            const n = nights(line.checkIn, line.checkOut);
            return (
              <div className="block-room-line" key={line.key}>
                <div className="block-room-line-head">
                  <span className="block-room-index">Room {index + 1}</span>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeLine(line.key)}
                      disabled={saving}
                      aria-label={`Remove room ${index + 1}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="field-grid">
                  <div className="field">
                    <label>Room type</label>
                    <select
                      value={line.roomTypeId}
                      onChange={(e) => updateLine(line.key, { roomTypeId: e.target.value })}
                      disabled={saving || noRoomTypes}
                    >
                      <option value="">Select…</option>
                      {roomTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.code ? ` (${t.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Rate plan</label>
                    <select
                      value={line.ratePlanId}
                      onChange={(e) => updateLine(line.key, { ratePlanId: e.target.value })}
                      disabled={saving || !line.roomTypeId}
                    >
                      <option value="">{!line.roomTypeId ? 'Pick a type first' : 'Select…'}</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.isRefundable ? '' : ' · Non-refundable'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field-grid">
                  <div className="field">
                    <label>Guest</label>
                    <select
                      value={line.guestId}
                      onChange={(e) => updateLine(line.key, { guestId: e.target.value })}
                      disabled={saving || noGuests}
                    >
                      <option value="">Select…</option>
                      {guests.map((g) => (
                        <option key={g.id} value={g.id}>
                          {guestFullName(g)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field block-room-dates">
                    <div className="field">
                      <label>Arrival</label>
                      <input
                        type="date"
                        min={todayIso()}
                        value={line.checkIn}
                        onChange={(e) => updateLine(line.key, { checkIn: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                    <div className="field">
                      <label>Departure</label>
                      <input
                        type="date"
                        min={line.checkIn || todayIso()}
                        value={line.checkOut}
                        onChange={(e) => updateLine(line.key, { checkOut: e.target.value })}
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>
                <p className="block-room-hint">{n > 0 ? `${n} night${n === 1 ? '' : 's'}` : 'Pick the stay dates.'}</p>
              </div>
            );
          })}
        </div>
      </form>
    </Modal>
  );
}

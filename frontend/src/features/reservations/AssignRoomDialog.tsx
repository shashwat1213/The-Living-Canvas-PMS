import { useEffect, useState } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { assignRoom, checkIn, listAssignableRooms } from './api';
import type { AssignableRoom, Reservation, ReservationListRow } from './types';
import { reservationGuestName } from './types';

interface AssignRoomDialogProps {
  propertyId: string;
  reservation: ReservationListRow;
  /**
   * `assign` just sets the room; `check-in` sets the room and moves the booking
   * to CHECKED_IN in one step — the standard front-desk arrival flow.
   */
  mode: 'assign' | 'check-in';
  onClose: () => void;
  onDone: (reservation: Reservation, message: string) => void;
}

/**
 * Room picker for assignment or check-in. Shows every ACTIVE room of the
 * booking's type with its availability for the stay dates — an occupied room is
 * visible but not selectable, so the clerk sees the whole floor and why a room
 * is unavailable, not a silently short list.
 */
export function AssignRoomDialog({ propertyId, reservation, mode, onClose, onDone }: AssignRoomDialogProps) {
  const [rooms, setRooms] = useState<AssignableRoom[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(reservation.roomId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listAssignableRooms(propertyId, reservation.id)
      .then((res) => {
        if (!active) return;
        setRooms(res);
        // Default to the currently-assigned room if it's still in the list.
        if (reservation.roomId && res.some((r) => r.id === reservation.roomId)) {
          setSelected(reservation.roomId);
        }
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Could not load rooms.');
      });
    return () => {
      active = false;
    };
  }, [propertyId, reservation.id, reservation.roomId]);

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated =
        mode === 'check-in'
          ? await checkIn(propertyId, reservation.id, selected)
          : await assignRoom(propertyId, reservation.id, selected);
      const room = rooms?.find((r) => r.id === selected);
      onDone(
        updated,
        mode === 'check-in'
          ? `${reservationGuestName(reservation.guest)} checked in${room ? ` to ${room.name}` : ''}.`
          : `Room ${room?.name ?? ''} assigned to ${reservation.reference}.`.trim(),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete this action.');
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'check-in' ? `Check in ${reservation.reference}` : `Assign a room — ${reservation.reference}`;
  const confirmLabel = mode === 'check-in' ? 'Check in' : 'Assign room';
  const noRooms = rooms !== null && rooms.length === 0;
  const noneFree = rooms !== null && rooms.length > 0 && rooms.every((r) => !r.available);

  return (
    <Modal
      title={title}
      description={`${reservation.roomType.name} · ${reservation.checkIn} → ${reservation.checkOut}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleConfirm()}
            disabled={saving || !selected}
          >
            {saving ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {loadError && (
        <p className="page-error" role="alert">
          {loadError}
        </p>
      )}
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {rooms === null && !loadError && <p className="reservation-detail-loading">Loading rooms…</p>}

      {noRooms && (
        <p className="booking-notice">
          No active rooms of this type exist. Add a room to the {reservation.roomType.name} catalogue first.
        </p>
      )}

      {noneFree && (
        <p className="booking-notice">Every {reservation.roomType.name} room is occupied for these dates.</p>
      )}

      {rooms && rooms.length > 0 && (
        <ul className="room-choice-list">
          {rooms.map((room) => {
            const disabled = !room.available && room.id !== reservation.roomId;
            return (
              <li key={room.id}>
                <label className={`room-choice${disabled ? ' room-choice-disabled' : ''}`}>
                  <input
                    type="radio"
                    name="assign-room"
                    value={room.id}
                    checked={selected === room.id}
                    disabled={disabled || saving}
                    onChange={() => setSelected(room.id)}
                  />
                  <span className="room-choice-name">{room.name}</span>
                  {room.floor && <span className="reservation-muted">Floor {room.floor}</span>}
                  {room.id === reservation.roomId ? (
                    <span className="room-choice-tag">Current</span>
                  ) : disabled ? (
                    <span className="room-choice-tag room-choice-tag-busy">Occupied</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

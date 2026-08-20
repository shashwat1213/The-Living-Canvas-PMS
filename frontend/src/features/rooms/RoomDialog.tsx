import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createRoom, updateRoom } from './api';
import { ROOM_STATUSES, ROOM_STATUS_LABEL, type Room, type RoomStatus } from './types';

interface RoomDialogProps {
  propertyId: string;
  /** `null` opens the dialog in create mode. */
  room: Room | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  name: string;
  roomType: string;
  floor: string;
  capacity: string;
  status: RoomStatus;
  notes: string;
}

function initialState(room: Room | null): FormState {
  return {
    name: room?.name ?? '',
    roomType: room?.roomType ?? '',
    floor: room?.floor ?? '',
    // Kept as a string so the input can be cleared while typing; parsed on submit.
    capacity: String(room?.capacity ?? 1),
    status: room?.status ?? 'ACTIVE',
    notes: room?.notes ?? '',
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Room name is required.';
  if (!form.roomType.trim()) errors.roomType = 'Room type is required.';

  const capacity = Number(form.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
    errors.capacity = 'Capacity must be a whole number between 1 and 50.';
  }
  return errors;
}

export function RoomDialog({ propertyId, room, onClose, onSaved }: RoomDialogProps) {
  const isCreate = room === null;
  const [form, setForm] = useState<FormState>(() => initialState(room));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
    const payload = {
      name: form.name.trim(),
      roomType: form.roomType.trim(),
      floor: optional(form.floor),
      capacity: Number(form.capacity),
      status: form.status,
      notes: optional(form.notes),
    };

    setSaving(true);
    try {
      if (isCreate) {
        const created = await createRoom(propertyId, payload);
        onSaved(`Room "${created.name}" was added.`);
      } else {
        const updated = await updateRoom(propertyId, room.id, payload);
        onSaved(`Room "${updated.name}" was updated.`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.issues?.length) {
          const mapped: Record<string, string> = {};
          for (const issue of err.issues) {
            const key = issue.path.split('.')[0];
            if (key) mapped[key] = issue.message;
          }
          setFieldErrors(mapped);
        }
      } else {
        setError(isCreate ? 'Could not add this room.' : 'Could not save these changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? 'Add room' : `Room ${room.name}`}
      description={isCreate ? 'A bookable unit at this property.' : room.roomType}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="room-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isCreate ? 'Add room' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="room-form" className="room-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="room-name">Name</label>
            <input
              id="room-name"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby="room-name-hint"
            />
            {fieldErrors.name ? (
              <span className="field-error">{fieldErrors.name}</span>
            ) : (
              <span id="room-name-hint" className="field-hint">
                e.g. 101, or Suite A. Unique within this property.
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="room-type">Room type</label>
            <input
              id="room-type"
              value={form.roomType}
              onChange={(event) => update('roomType', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.roomType)}
            />
            {fieldErrors.roomType && <span className="field-error">{fieldErrors.roomType}</span>}
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="room-floor">Floor</label>
            <input
              id="room-floor"
              value={form.floor}
              onChange={(event) => update('floor', event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="field">
            <label htmlFor="room-capacity">Capacity</label>
            <input
              id="room-capacity"
              type="number"
              min={1}
              max={50}
              value={form.capacity}
              onChange={(event) => update('capacity', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.capacity)}
            />
            {fieldErrors.capacity && <span className="field-error">{fieldErrors.capacity}</span>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="room-status">Status</label>
          <select
            id="room-status"
            value={form.status}
            onChange={(event) => update('status', event.target.value as RoomStatus)}
            disabled={saving}
            aria-describedby="room-status-hint"
          >
            {ROOM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ROOM_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          <span id="room-status-hint" className="field-hint">
            Operational state only — this is not occupancy.
          </span>
        </div>

        <div className="field">
          <label htmlFor="room-notes">Notes</label>
          <input
            id="room-notes"
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            disabled={saving}
          />
        </div>
      </form>
    </Modal>
  );
}

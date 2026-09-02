import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { listRoomTypes } from '../room-types/api';
import type { RoomType } from '../room-types/types';
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
  roomTypeId: string;
  floor: string;
  capacity: string;
  status: RoomStatus;
  notes: string;
}

function initialState(room: Room | null): FormState {
  return {
    name: room?.name ?? '',
    roomTypeId: room?.roomTypeId ?? '',
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
  if (!form.roomTypeId) errors.roomTypeId = 'Choose a room type.';

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
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [typesFailed, setTypesFailed] = useState(false);

  /**
   * A room must be assigned a type from the property's catalogue, so the
   * catalogue is loaded up front. Active types only — a retired type is
   * not offered for new assignment, though a room already on one keeps it
   * (added to the options below so editing an existing room never silently
   * drops its type).
   */
  useEffect(() => {
    let cancelled = false;
    setLoadingTypes(true);
    setTypesFailed(false);
    listRoomTypes(propertyId, { status: 'ACTIVE', pageSize: 100 })
      .then((result) => {
        if (!cancelled) setRoomTypes(result.roomTypes ?? []);
      })
      .catch(() => {
        if (!cancelled) setTypesFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  // A room already linked to a retired (or otherwise unlisted) type keeps
  // showing it rather than resetting the field when the dialog opens.
  const options =
    room?.roomTypeId && !roomTypes.some((type) => type.id === room.roomTypeId)
      ? [{ id: room.roomTypeId, name: room.roomType.name, code: room.roomType.code } as RoomType, ...roomTypes]
      : roomTypes;
  const hasCatalogue = options.length > 0;

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
      roomTypeId: form.roomTypeId,
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

  // Create is blocked with a helpful empty state when the property has no
  // room types yet: a room can't exist without one, so we point the user
  // at the catalogue rather than showing a form they can't submit. Editing
  // an existing room always has at least that room's own type to show.
  const blockedNoTypes = isCreate && !loadingTypes && !typesFailed && !hasCatalogue;

  return (
    <Modal
      title={isCreate ? 'Add room' : `Room ${room.name}`}
      description={isCreate ? 'A bookable unit at this property.' : room.roomType.name}
      size="wide"
      onClose={onClose}
      footer={
        blockedNoTypes ? (
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              form="room-form"
              className="btn btn-primary"
              disabled={saving || loadingTypes || typesFailed}
            >
              {saving ? 'Saving…' : isCreate ? 'Add room' : 'Save changes'}
            </button>
          </>
        )
      }
    >
      {blockedNoTypes ? (
        <div className="empty-state" role="status">
          <p className="empty-state-title">No room types yet</p>
          <p className="empty-state-body">
            Every room belongs to a room type, so add at least one before creating rooms.
          </p>
          <Link className="btn btn-primary" to={`/app/properties/${propertyId}/room-types`}>
            Manage room types
          </Link>
        </div>
      ) : (
        <form id="room-form" className="room-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          {error && (
            <p className="page-error" role="alert">
              {error}
            </p>
          )}
          {typesFailed && (
            <p className="page-error" role="alert">
              Could not load room types. Close and try again.
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
              <label htmlFor="room-type-select">Room type</label>
              <select
                id="room-type-select"
                value={form.roomTypeId}
                onChange={(event) => update('roomTypeId', event.target.value)}
                disabled={saving || loadingTypes}
                aria-invalid={Boolean(fieldErrors.roomTypeId)}
                aria-describedby="room-type-hint"
              >
                <option value="" disabled>
                  {loadingTypes ? 'Loading…' : 'Select a room type'}
                </option>
                {options.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code ? `${type.name} (${type.code})` : type.name}
                  </option>
                ))}
              </select>
              {fieldErrors.roomTypeId ? (
                <span className="field-error">{fieldErrors.roomTypeId}</span>
              ) : (
                <span id="room-type-hint" className="field-hint">
                  From this property's room-type catalogue.
                </span>
              )}
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
      )}
    </Modal>
  );
}

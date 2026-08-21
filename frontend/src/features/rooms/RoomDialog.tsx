import { useEffect, useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { listRoomTypes } from '../room-types/api';
import type { RoomType } from '../room-types/types';
import { createRoom, updateRoom } from './api';
import { ROOM_STATUSES, ROOM_STATUS_LABEL, type Room, type RoomStatus } from './types';

/** Sentinel for "no structured type — I'll type the label myself". */
const CUSTOM = '';

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
  roomType: string;
  floor: string;
  capacity: string;
  status: RoomStatus;
  notes: string;
}

function initialState(room: Room | null): FormState {
  return {
    name: room?.name ?? '',
    roomTypeId: room?.roomTypeId ?? CUSTOM,
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
  // Either form satisfies the API: a chosen type, or a typed-in label.
  if (form.roomTypeId === CUSTOM && !form.roomType.trim()) errors.roomType = 'Room type is required.';

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

  /**
   * The catalogue is a convenience, never a gate: if it fails to load, or
   * the property has no types configured yet, the dialog falls back to the
   * free-text field that has always been here. A room must stay creatable
   * even when this request doesn't come back.
   */
  useEffect(() => {
    let cancelled = false;
    listRoomTypes(propertyId, { status: 'ACTIVE', pageSize: 100 })
      .then((result) => {
        if (!cancelled) setRoomTypes(result.roomTypes ?? []);
      })
      .catch(() => {
        if (!cancelled) setRoomTypes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  // A room already linked to a retired type still shows it, rather than
  // silently resetting the field to "custom" when the dialog opens.
  const options =
    room?.roomTypeId && !roomTypes.some((type) => type.id === room.roomTypeId)
      ? [...roomTypes, { id: room.roomTypeId, name: room.roomType } as RoomType]
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
    // Exactly one of the two is sent. With a type chosen the server
    // derives the legacy label from it, which is what keeps the two
    // representations from drifting apart during the transition.
    const typeFields =
      form.roomTypeId === CUSTOM
        ? { roomType: form.roomType.trim(), roomTypeId: null }
        : { roomTypeId: form.roomTypeId };

    const payload = {
      name: form.name.trim(),
      ...typeFields,
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
            <label htmlFor={hasCatalogue ? 'room-type-select' : 'room-type'}>Room type</label>
            {hasCatalogue ? (
              <>
                <select
                  id="room-type-select"
                  value={form.roomTypeId}
                  onChange={(event) => update('roomTypeId', event.target.value)}
                  disabled={saving}
                  aria-describedby="room-type-hint"
                >
                  {options.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.code ? `${type.name} (${type.code})` : type.name}
                    </option>
                  ))}
                  <option value={CUSTOM}>Other — enter manually</option>
                </select>
                {form.roomTypeId === CUSTOM && (
                  <input
                    id="room-type"
                    aria-label="Room type label"
                    placeholder="e.g. Deluxe King"
                    value={form.roomType}
                    onChange={(event) => update('roomType', event.target.value)}
                    disabled={saving}
                    aria-invalid={Boolean(fieldErrors.roomType)}
                  />
                )}
                <span id="room-type-hint" className="field-hint">
                  {form.roomTypeId === CUSTOM
                    ? 'Not in the catalogue yet — this stays free text.'
                    : "The property's room-type catalogue."}
                </span>
              </>
            ) : (
              <input
                id="room-type"
                value={form.roomType}
                onChange={(event) => update('roomType', event.target.value)}
                disabled={saving}
                aria-invalid={Boolean(fieldErrors.roomType)}
                aria-describedby={loadingTypes ? 'room-type-hint' : undefined}
              />
            )}
            {fieldErrors.roomType && <span className="field-error">{fieldErrors.roomType}</span>}
            {!hasCatalogue && loadingTypes && (
              <span id="room-type-hint" className="field-hint">
                Loading room types…
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
    </Modal>
  );
}

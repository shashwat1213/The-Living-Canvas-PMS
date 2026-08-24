import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createRoomType, updateRoomType } from './api';
import {
  ROOM_TYPE_CODE_MAX_LENGTH,
  ROOM_TYPE_CODE_PATTERN,
  ROOM_TYPE_DESCRIPTION_MAX_LENGTH,
  ROOM_TYPE_NAME_MAX_LENGTH,
  type CreateRoomTypeInput,
  type RoomType,
  type UpdateRoomTypeInput,
} from './types';

interface RoomTypeDialogProps {
  propertyId: string;
  /** `null` opens the dialog in create mode. */
  roomType: RoomType | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  name: string;
  code: string;
  description: string;
}

/**
 * Active/retired is deliberately **not** in this form. It has its own
 * action in the list, with a confirmation that explains what retiring
 * does to the rooms already classified under the type. Offering the same
 * state change in two places — one of them a quiet checkbox among text
 * fields — is how someone retires a type they only meant to rename.
 */
function initialState(roomType: RoomType | null): FormState {
  return {
    name: roomType?.name ?? '',
    code: roomType?.code ?? '',
    description: roomType?.description ?? '',
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = form.name.trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > ROOM_TYPE_NAME_MAX_LENGTH) {
    errors.name = `Name must be ${ROOM_TYPE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const code = form.code.trim();
  if (code) {
    if (code.length > ROOM_TYPE_CODE_MAX_LENGTH) {
      errors.code = `Code must be ${ROOM_TYPE_CODE_MAX_LENGTH} characters or fewer.`;
    } else if (!ROOM_TYPE_CODE_PATTERN.test(code)) {
      errors.code = 'Use letters, numbers or hyphens only.';
    }
  }

  if (form.description.trim().length > ROOM_TYPE_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be ${ROOM_TYPE_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

/**
 * What actually changed, as a PATCH body.
 *
 * Two reasons this is a diff rather than the whole form. The API's update
 * schema requires at least one field, so an unchanged submit is a 400
 * waiting to happen; and `code` is compared case-insensitively because
 * the server stores it upper-cased — retyping "dlxk" over "DLXK" is not
 * an edit, and sending it as one would record a phantom audit entry.
 *
 * `blanked` is separate from `changes` because the API's optional fields
 * accept a string or nothing at all, not `null`: there is currently no
 * way to *remove* a code or description once set, so the dialog says so
 * instead of sending a payload the server would reject.
 */
function diffForm(form: FormState, before: RoomType): { changes: UpdateRoomTypeInput; blanked: string[] } {
  const changes: UpdateRoomTypeInput = {};
  const blanked: string[] = [];

  const name = form.name.trim();
  if (name !== before.name) changes.name = name;

  const code = form.code.trim().toUpperCase();
  if (code !== (before.code ?? '')) {
    if (code === '') blanked.push('code');
    else changes.code = code;
  }

  const description = form.description.trim();
  if (description !== (before.description ?? '')) {
    if (description === '') blanked.push('description');
    else changes.description = description;
  }

  return { changes, blanked };
}

const CANNOT_CLEAR: Record<string, string> = {
  code: 'A code cannot be removed once set — replace it with another value instead.',
  description: 'A description cannot be removed once set — replace it with other text instead.',
};

export function RoomTypeDialog({ propertyId, roomType, onClose, onSaved }: RoomTypeDialogProps) {
  const isCreate = roomType === null;
  const [form, setForm] = useState<FormState>(() => initialState(roomType));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const diff = isCreate ? null : diffForm(form, roomType);
  // Nothing to send is not an error worth a message — the control that
  // would send it simply isn't offered.
  const nothingToSave = diff !== null && Object.keys(diff.changes).length === 0 && diff.blanked.length === 0;

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

    let payload: CreateRoomTypeInput | UpdateRoomTypeInput;
    if (diff === null) {
      const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
      payload = {
        name: form.name.trim(),
        code: optional(form.code),
        description: optional(form.description),
      };
    } else {
      if (diff.blanked.length > 0) {
        setFieldErrors(Object.fromEntries(diff.blanked.map((field) => [field, CANNOT_CLEAR[field] ?? ''])));
        return;
      }
      payload = diff.changes;
    }

    setSaving(true);
    try {
      if (roomType === null) {
        const created = await createRoomType(propertyId, payload as CreateRoomTypeInput);
        onSaved(`Room type "${created.name}" was added.`);
      } else {
        const updated = await updateRoomType(propertyId, roomType.id, payload);
        onSaved(`Room type "${updated.name}" was updated.`);
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
        setError(isCreate ? 'Could not add this room type.' : 'Could not save these changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? 'Add room type' : `Room type ${roomType.name}`}
      description={
        isCreate
          ? 'A sellable category of room at this property — rates and availability will hang off it.'
          : 'Renaming a type updates it everywhere it is used.'
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="room-type-form"
            className="btn btn-primary"
            disabled={saving || nothingToSave}
          >
            {saving ? 'Saving…' : isCreate ? 'Add room type' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="room-type-form" className="room-type-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="room-type-name">Name</label>
            <input
              id="room-type-name"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby="room-type-name-hint"
            />
            {fieldErrors.name ? (
              <span className="field-error">{fieldErrors.name}</span>
            ) : (
              <span id="room-type-name-hint" className="field-hint">
                e.g. Deluxe King. Unique within this property.
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="room-type-code">Code</label>
            <input
              id="room-type-code"
              value={form.code}
              onChange={(event) => update('code', event.target.value)}
              disabled={saving}
              maxLength={ROOM_TYPE_CODE_MAX_LENGTH}
              aria-invalid={Boolean(fieldErrors.code)}
              aria-describedby="room-type-code-hint"
            />
            {fieldErrors.code ? (
              <span className="field-error">{fieldErrors.code}</span>
            ) : (
              <span id="room-type-code-hint" className="field-hint">
                Optional short code for rooming lists — DLXK. Stored upper-case.
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="room-type-description">Description</label>
          <textarea
            id="room-type-description"
            rows={3}
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby="room-type-description-hint"
          />
          {fieldErrors.description ? (
            <span className="field-error">{fieldErrors.description}</span>
          ) : (
            <span id="room-type-description-hint" className="field-hint">
              What a guest gets — shown to staff, and to rate plans later.
            </span>
          )}
        </div>
      </form>
    </Modal>
  );
}

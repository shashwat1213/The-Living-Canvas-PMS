import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createGuest, updateGuest } from './api';
import {
  GUEST_NAME_MAX_LENGTH,
  GUEST_NOTES_MAX_LENGTH,
  type CreateGuestInput,
  type Guest,
  type UpdateGuestInput,
} from './types';

interface GuestDialogProps {
  /** `null` opens the dialog in create mode. */
  guest: Guest | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
}

function initialState(guest: Guest | null): FormState {
  return {
    firstName: guest?.firstName ?? '',
    lastName: guest?.lastName ?? '',
    email: guest?.email ?? '',
    phone: guest?.phone ?? '',
    notes: guest?.notes ?? '',
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.firstName.trim()) errors.firstName = 'First name is required.';
  else if (form.firstName.trim().length > GUEST_NAME_MAX_LENGTH) errors.firstName = 'Too long.';
  if (!form.lastName.trim()) errors.lastName = 'Last name is required.';
  else if (form.lastName.trim().length > GUEST_NAME_MAX_LENGTH) errors.lastName = 'Too long.';
  // Light client-side email shape check; the server is authoritative.
  if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.notes.trim().length > GUEST_NOTES_MAX_LENGTH) errors.notes = 'Too long.';
  return errors;
}

/**
 * A PATCH diff. Contact fields are `.nullable()` server-side, so a cleared
 * value is sent as an explicit `null`; names stay required-when-present.
 */
function diffForm(form: FormState, before: Guest): UpdateGuestInput {
  const changes: UpdateGuestInput = {};
  const firstName = form.firstName.trim();
  if (firstName !== before.firstName) changes.firstName = firstName;
  const lastName = form.lastName.trim();
  if (lastName !== before.lastName) changes.lastName = lastName;
  const email = form.email.trim().toLowerCase();
  if (email !== (before.email ?? '')) changes.email = email === '' ? null : email;
  const phone = form.phone.trim();
  if (phone !== (before.phone ?? '')) changes.phone = phone === '' ? null : phone;
  const notes = form.notes.trim();
  if (notes !== (before.notes ?? '')) changes.notes = notes === '' ? null : notes;
  return changes;
}

export function GuestDialog({ guest, onClose, onSaved }: GuestDialogProps) {
  const isCreate = guest === null;
  const [form, setForm] = useState<FormState>(() => initialState(guest));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const diff = isCreate ? null : diffForm(form, guest);
  const nothingToSave = diff !== null && Object.keys(diff).length === 0;

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

    let payload: CreateGuestInput | UpdateGuestInput;
    if (diff === null) {
      const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
      payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: optional(form.email.toLowerCase()),
        phone: optional(form.phone),
        notes: optional(form.notes),
      };
    } else {
      payload = diff;
    }

    setSaving(true);
    try {
      if (guest === null) {
        const created = await createGuest(payload as CreateGuestInput);
        onSaved(`${created.firstName} ${created.lastName} was added.`);
      } else {
        const updated = await updateGuest(guest.id, payload);
        onSaved(`${updated.firstName} ${updated.lastName} was updated.`);
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
        setError(isCreate ? 'Could not add this guest.' : 'Could not save these changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? 'Add guest' : `${guest.firstName} ${guest.lastName}`}
      description={isCreate ? 'A guest profile the organization owns — reusable across every property.' : undefined}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="guest-form" className="btn btn-primary" disabled={saving || nothingToSave}>
            {saving ? 'Saving…' : isCreate ? 'Add guest' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="guest-form" className="guest-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="guest-first">First name</label>
            <input
              id="guest-first"
              value={form.firstName}
              onChange={(event) => update('firstName', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.firstName)}
            />
            {fieldErrors.firstName && <span className="field-error">{fieldErrors.firstName}</span>}
          </div>
          <div className="field">
            <label htmlFor="guest-last">Last name</label>
            <input
              id="guest-last"
              value={form.lastName}
              onChange={(event) => update('lastName', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.lastName)}
            />
            {fieldErrors.lastName && <span className="field-error">{fieldErrors.lastName}</span>}
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="guest-email">Email</label>
            <input
              id="guest-email"
              type="email"
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby="guest-email-hint"
            />
            {fieldErrors.email ? (
              <span className="field-error">{fieldErrors.email}</span>
            ) : (
              <span id="guest-email-hint" className="field-hint">
                Optional — a walk-in may not give one.
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="guest-phone">Phone</label>
            <input
              id="guest-phone"
              value={form.phone}
              onChange={(event) => update('phone', event.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="guest-notes">Notes</label>
          <textarea
            id="guest-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.notes)}
          />
          {fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
        </div>
      </form>
    </Modal>
  );
}

import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createProperty, updateProperty } from './api';
import type { Property } from './types';

interface PropertyDialogProps {
  /** `null` opens the dialog in create mode. */
  property: Property | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  name: string;
  slug: string;
  timezone: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function initialState(property: Property | null): FormState {
  return {
    name: property?.name ?? '',
    slug: property?.slug ?? '',
    timezone: property?.timezone ?? 'UTC',
    addressLine1: property?.addressLine1 ?? '',
    city: property?.city ?? '',
    region: property?.region ?? '',
    postalCode: property?.postalCode ?? '',
    country: property?.country ?? '',
  };
}

/** Mirrors the API's Zod schema for immediate feedback; the server validates independently. */
function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Name is required.';
  if (!form.slug.trim()) errors.slug = 'Slug is required.';
  else if (!SLUG_PATTERN.test(form.slug)) errors.slug = 'Lowercase letters, numbers and hyphens only.';
  return errors;
}

/** Derives a URL-safe slug from a name, so the field usually fills itself. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function PropertyDialog({ property, onClose, onSaved }: PropertyDialogProps) {
  const isCreate = property === null;
  const [form, setForm] = useState<FormState>(() => initialState(property));
  // Once the slug has been typed into, stop overwriting it from the name —
  // silently rewriting a value someone chose is worse than a blank field.
  const [slugTouched, setSlugTouched] = useState(!isCreate);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  }

  function handleNameChange(value: string) {
    setForm((current) => ({
      ...current,
      name: value,
      slug: slugTouched ? current.slug : slugify(value),
    }));
    setFieldErrors((current) => ({ ...current, name: '', slug: '' }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Optional text fields go as undefined rather than "" — the API
    // treats an empty string as a value, and blanking a field is not the
    // same request as leaving it alone.
    const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      timezone: optional(form.timezone),
      addressLine1: optional(form.addressLine1),
      city: optional(form.city),
      region: optional(form.region),
      postalCode: optional(form.postalCode),
      country: optional(form.country),
    };

    setSaving(true);
    try {
      if (isCreate) {
        const created = await createProperty(payload);
        onSaved(`"${created.name}" was added.`);
      } else {
        const updated = await updateProperty(property.id, payload);
        onSaved(`"${updated.name}" was updated.`);
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
        setError(isCreate ? 'Could not add this property.' : 'Could not save these changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? 'Add property' : property.name}
      description={isCreate ? 'A venue your team will manage rooms for.' : `/${property.slug}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="property-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isCreate ? 'Add property' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="property-form" className="property-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="property-name">Name</label>
            <input
              id="property-name"
              value={form.name}
              onChange={(event) => handleNameChange(event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.name)}
            />
            {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
          </div>

          <div className="field">
            <label htmlFor="property-slug">Slug</label>
            <input
              id="property-slug"
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true);
                update('slug', event.target.value);
              }}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.slug)}
              aria-describedby="property-slug-hint"
            />
            {fieldErrors.slug ? (
              <span className="field-error">{fieldErrors.slug}</span>
            ) : (
              <span id="property-slug-hint" className="field-hint">
                Used in URLs. Lowercase letters, numbers and hyphens.
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="property-address">Address</label>
          <input
            id="property-address"
            value={form.addressLine1}
            onChange={(event) => update('addressLine1', event.target.value)}
            disabled={saving}
          />
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="property-city">City</label>
            <input
              id="property-city"
              value={form.city}
              onChange={(event) => update('city', event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="field">
            <label htmlFor="property-region">Region</label>
            <input
              id="property-region"
              value={form.region}
              onChange={(event) => update('region', event.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <div className="field-grid">
          <div className="field">
            <label htmlFor="property-postal">Postal code</label>
            <input
              id="property-postal"
              value={form.postalCode}
              onChange={(event) => update('postalCode', event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="field">
            <label htmlFor="property-country">Country</label>
            <input
              id="property-country"
              value={form.country}
              onChange={(event) => update('country', event.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="property-timezone">Timezone</label>
          <input
            id="property-timezone"
            value={form.timezone}
            onChange={(event) => update('timezone', event.target.value)}
            disabled={saving}
            aria-describedby="property-timezone-hint"
          />
          <span id="property-timezone-hint" className="field-hint">
            IANA name, e.g. Asia/Kolkata. Defaults to UTC.
          </span>
        </div>
      </form>
    </Modal>
  );
}

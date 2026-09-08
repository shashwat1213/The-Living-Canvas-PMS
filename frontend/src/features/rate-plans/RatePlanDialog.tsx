import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createRatePlan, updateRatePlan } from './api';
import {
  RATE_PLAN_CODE_MAX_LENGTH,
  RATE_PLAN_CODE_PATTERN,
  RATE_PLAN_DESCRIPTION_MAX_LENGTH,
  RATE_PLAN_NAME_MAX_LENGTH,
  type CreateRatePlanInput,
  type RatePlan,
  type UpdateRatePlanInput,
} from './types';

interface RatePlanDialogProps {
  propertyId: string;
  roomTypeId: string;
  /** `null` opens the dialog in create mode. */
  ratePlan: RatePlan | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  name: string;
  code: string;
  description: string;
  isRefundable: boolean;
}

/**
 * Active/retired is deliberately not in this form — it has its own row
 * action with a confirmation, exactly as room types do. `isRefundable`
 * *is* here: it is a defining property of the plan a manager sets when
 * creating it ("Non-Refundable"), not a lifecycle state.
 */
function initialState(ratePlan: RatePlan | null): FormState {
  return {
    name: ratePlan?.name ?? '',
    code: ratePlan?.code ?? '',
    description: ratePlan?.description ?? '',
    isRefundable: ratePlan?.isRefundable ?? true,
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = form.name.trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > RATE_PLAN_NAME_MAX_LENGTH) {
    errors.name = `Name must be ${RATE_PLAN_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const code = form.code.trim();
  if (code) {
    if (code.length > RATE_PLAN_CODE_MAX_LENGTH) {
      errors.code = `Code must be ${RATE_PLAN_CODE_MAX_LENGTH} characters or fewer.`;
    } else if (!RATE_PLAN_CODE_PATTERN.test(code)) {
      errors.code = 'Use letters, numbers or hyphens only.';
    }
  }

  if (form.description.trim().length > RATE_PLAN_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be ${RATE_PLAN_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

const CANNOT_CLEAR: Record<string, string> = {
  code: 'A code cannot be removed once set — replace it with another value instead.',
  description: 'A description cannot be removed once set — replace it with other text instead.',
};

/**
 * A PATCH diff. `code`/`description` are `.nullable()` server-side, so a
 * cleared value is sent as an explicit `null` — unlike room types, blanking
 * is a real edit here, not a rejected one.
 */
function diffForm(form: FormState, before: RatePlan): UpdateRatePlanInput {
  const changes: UpdateRatePlanInput = {};

  const name = form.name.trim();
  if (name !== before.name) changes.name = name;

  const code = form.code.trim().toUpperCase();
  if (code !== (before.code ?? '')) changes.code = code === '' ? null : code;

  const description = form.description.trim();
  if (description !== (before.description ?? '')) changes.description = description === '' ? null : description;

  if (form.isRefundable !== before.isRefundable) changes.isRefundable = form.isRefundable;

  return changes;
}

export function RatePlanDialog({ propertyId, roomTypeId, ratePlan, onClose, onSaved }: RatePlanDialogProps) {
  const isCreate = ratePlan === null;
  const [form, setForm] = useState<FormState>(() => initialState(ratePlan));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const diff = isCreate ? null : diffForm(form, ratePlan);
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

    let payload: CreateRatePlanInput | UpdateRatePlanInput;
    if (diff === null) {
      const optional = (value: string) => (value.trim() === '' ? undefined : value.trim());
      payload = {
        name: form.name.trim(),
        code: optional(form.code),
        description: optional(form.description),
        isRefundable: form.isRefundable,
      };
    } else {
      payload = diff;
    }

    setSaving(true);
    try {
      if (ratePlan === null) {
        const created = await createRatePlan(propertyId, roomTypeId, payload as CreateRatePlanInput);
        onSaved(`Rate plan "${created.name}" was added.`);
      } else {
        const updated = await updateRatePlan(propertyId, roomTypeId, ratePlan.id, payload);
        onSaved(`Rate plan "${updated.name}" was updated.`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.issues?.length) {
          const mapped: Record<string, string> = {};
          for (const issue of err.issues) {
            const key = issue.path.split('.')[0];
            if (key) mapped[key] = CANNOT_CLEAR[key] ?? issue.message;
          }
          setFieldErrors(mapped);
        }
      } else {
        setError(isCreate ? 'Could not add this rate plan.' : 'Could not save these changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? 'Add rate plan' : `Rate plan ${ratePlan.name}`}
      description={
        isCreate
          ? 'A sellable rate for this room type — set its per-night prices from the calendar after creating it.'
          : 'A rate plan defines how this room type is sold and whether it can be cancelled for a refund.'
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="rate-plan-form" className="btn btn-primary" disabled={saving || nothingToSave}>
            {saving ? 'Saving…' : isCreate ? 'Add rate plan' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="rate-plan-form" className="rate-plan-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="rate-plan-name">Name</label>
            <input
              id="rate-plan-name"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              disabled={saving}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby="rate-plan-name-hint"
            />
            {fieldErrors.name ? (
              <span className="field-error">{fieldErrors.name}</span>
            ) : (
              <span id="rate-plan-name-hint" className="field-hint">
                e.g. Best Available Rate. Unique within this room type.
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="rate-plan-code">Code</label>
            <input
              id="rate-plan-code"
              value={form.code}
              onChange={(event) => update('code', event.target.value)}
              disabled={saving}
              maxLength={RATE_PLAN_CODE_MAX_LENGTH}
              aria-invalid={Boolean(fieldErrors.code)}
              aria-describedby="rate-plan-code-hint"
            />
            {fieldErrors.code ? (
              <span className="field-error">{fieldErrors.code}</span>
            ) : (
              <span id="rate-plan-code-hint" className="field-hint">
                Optional short code — BAR, NR. Stored upper-case.
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="rate-plan-description">Description</label>
          <textarea
            id="rate-plan-description"
            rows={2}
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            disabled={saving}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby="rate-plan-description-hint"
          />
          {fieldErrors.description ? (
            <span className="field-error">{fieldErrors.description}</span>
          ) : (
            <span id="rate-plan-description-hint" className="field-hint">
              What this rate includes or its cancellation terms.
            </span>
          )}
        </div>

        <label className="rate-plan-checkbox">
          <input
            type="checkbox"
            checked={form.isRefundable}
            onChange={(event) => update('isRefundable', event.target.checked)}
            disabled={saving}
          />
          <span>
            Refundable
            <span className="field-hint">
              Leave on for a flexible rate; turn off for a non-refundable / advance-purchase plan.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

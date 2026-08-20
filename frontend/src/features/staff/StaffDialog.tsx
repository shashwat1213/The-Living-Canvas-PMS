import { useState, type FormEvent } from 'react';

import type { SessionClaims } from '../../auth/session';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createStaffMember, setStaffPropertyAccess, updateStaffMember } from './api';
import { assignableRoles, canManageMember, manageBlockedReason, MANAGE_BLOCKED_LABEL } from './permissions';
import {
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  SYSTEM_ROLES,
  effectiveRole,
  fullName,
  type PropertyOption,
  type StaffMember,
  type SystemRoleName,
} from './types';

interface StaffDialogProps {
  /** `null` opens the dialog in create mode. */
  member: StaffMember | null;
  properties: PropertyOption[];
  session: SessionClaims | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: SystemRoleName;
  propertyIds: string[];
}

/** Roles with organization-wide reach; property grants are redundant for them. */
const ORG_WIDE_ROLES: SystemRoleName[] = ['OWNER', 'ADMIN'];

function initialState(member: StaffMember | null, defaultRole: SystemRoleName): FormState {
  return {
    firstName: member?.firstName ?? '',
    lastName: member?.lastName ?? '',
    email: member?.email ?? '',
    password: '',
    role: member ? effectiveRole(member) : defaultRole,
    propertyIds: member?.propertyIds ?? [],
  };
}

/**
 * Client-side validation mirroring the API's Zod schema, for immediate
 * feedback only. The server validates independently and its response is
 * what's shown if the two ever disagree.
 */
function validate(form: FormState, isCreate: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.firstName.trim()) errors.firstName = 'First name is required.';
  if (!form.lastName.trim()) errors.lastName = 'Last name is required.';
  if (isCreate) {
    if (!form.email.trim()) errors.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Enter a valid email address.';
    if (form.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  }
  return errors;
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/**
 * Create/edit surface for a single staff member. One dialog for both
 * because the fields overlap almost entirely — only the credential fields
 * are create-only, since the API supports neither changing an email nor
 * resetting a password.
 */
export function StaffDialog({ member, properties, session, onClose, onSaved }: StaffDialogProps) {
  const isCreate = member === null;
  const roleChoices = assignableRoles(session, SYSTEM_ROLES);
  const [form, setForm] = useState<FormState>(() =>
    initialState(member, roleChoices.includes('STAFF') ? 'STAFF' : (roleChoices[0] ?? 'STAFF')),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // In edit mode the rank rules decide whether anything is changeable at
  // all; the dialog still opens so details can be read.
  const blockedReason = member ? manageBlockedReason(session, member) : null;
  const editable = isCreate || (member !== null && canManageMember(session, member));
  const showPropertyPicker = !ORG_WIDE_ROLES.includes(form.role);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: '' }));
  }

  function togglePropertyAccess(propertyId: string) {
    setForm((current) => ({
      ...current,
      propertyIds: current.propertyIds.includes(propertyId)
        ? current.propertyIds.filter((id) => id !== propertyId)
        : [...current.propertyIds, propertyId],
    }));
  }

  /** Turns the API's field-level `issues` into per-input messages. */
  function applyApiError(err: unknown, fallback: string) {
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
      setError(fallback);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const errors = validate(form, isCreate);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      if (isCreate) {
        const created = await createStaffMember({
          email: form.email.trim(),
          password: form.password,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          ...(showPropertyPicker && form.propertyIds.length > 0 ? { propertyIds: form.propertyIds } : {}),
        });
        onSaved(`${fullName(created)} was added to your team.`);
        return;
      }

      // Edit: role and property access are two separate endpoints, so
      // only the ones that actually changed are called. Sending an
      // unchanged role would still bump the member's token watermark and
      // needlessly interrupt their session.
      const roleChanged = form.role !== effectiveRole(member);
      const nameChanged = form.firstName.trim() !== member.firstName || form.lastName.trim() !== member.lastName;
      const accessChanged = showPropertyPicker && !sameIds(form.propertyIds, member.propertyIds);

      if (nameChanged || roleChanged) {
        await updateStaffMember(member.id, {
          ...(nameChanged ? { firstName: form.firstName.trim(), lastName: form.lastName.trim() } : {}),
          ...(roleChanged ? { role: form.role } : {}),
        });
      }
      if (accessChanged) {
        await setStaffPropertyAccess(member.id, form.propertyIds);
      }

      if (!nameChanged && !roleChanged && !accessChanged) {
        onClose();
        return;
      }
      onSaved(`${form.firstName.trim()} ${form.lastName.trim()}'s details were updated.`);
    } catch (err) {
      applyApiError(err, isCreate ? 'Could not add this staff member.' : 'Could not save these changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isCreate ? 'Add staff member' : fullName(member)}
      description={isCreate ? 'They can sign in as soon as you save.' : member.email}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            {editable ? 'Cancel' : 'Close'}
          </button>
          {editable && (
            <button type="submit" form="staff-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isCreate ? 'Add staff member' : 'Save changes'}
            </button>
          )}
        </>
      }
    >
      <form id="staff-form" className="staff-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        {!editable && blockedReason && (
          <p className="staff-readonly-note" role="status">
            {MANAGE_BLOCKED_LABEL[blockedReason]} You can view their details, but not change them.
          </p>
        )}

        <div className="field-grid">
          <div className="field">
            <label htmlFor="staff-first-name">First name</label>
            <input
              id="staff-first-name"
              value={form.firstName}
              onChange={(event) => update('firstName', event.target.value)}
              disabled={!editable || saving}
              aria-invalid={Boolean(fieldErrors.firstName)}
              autoComplete="given-name"
            />
            {fieldErrors.firstName && <span className="field-error">{fieldErrors.firstName}</span>}
          </div>

          <div className="field">
            <label htmlFor="staff-last-name">Last name</label>
            <input
              id="staff-last-name"
              value={form.lastName}
              onChange={(event) => update('lastName', event.target.value)}
              disabled={!editable || saving}
              aria-invalid={Boolean(fieldErrors.lastName)}
              autoComplete="family-name"
            />
            {fieldErrors.lastName && <span className="field-error">{fieldErrors.lastName}</span>}
          </div>
        </div>

        {isCreate ? (
          <div className="field-grid">
            <div className="field">
              <label htmlFor="staff-email">Email</label>
              <input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                disabled={saving}
                aria-invalid={Boolean(fieldErrors.email)}
                autoComplete="off"
              />
              {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}
            </div>

            <div className="field">
              <label htmlFor="staff-password">Temporary password</label>
              <input
                id="staff-password"
                type="password"
                value={form.password}
                onChange={(event) => update('password', event.target.value)}
                disabled={saving}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby="staff-password-hint"
                autoComplete="new-password"
              />
              {fieldErrors.password ? (
                <span className="field-error">{fieldErrors.password}</span>
              ) : (
                <span id="staff-password-hint" className="field-hint">
                  At least 8 characters. Share it with them directly — there is no invite email yet.
                </span>
              )}
            </div>
          </div>
        ) : (
          <dl className="staff-facts">
            <div>
              <dt>Email</dt>
              <dd>{member.email}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge tone={member.isActive ? 'positive' : 'muted'}>{member.isActive ? 'Active' : 'Deactivated'}</Badge>
              </dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{new Date(member.createdAt).toLocaleDateString()}</dd>
            </div>
          </dl>
        )}

        <div className="field">
          <label htmlFor="staff-role">Role</label>
          <select
            id="staff-role"
            value={form.role}
            onChange={(event) => update('role', event.target.value as SystemRoleName)}
            disabled={!editable || saving}
            aria-describedby="staff-role-hint"
          >
            {/* Only roles at or below the caller's own level, matching the
                server rule — an option that would always be rejected is
                worse than one that isn't offered. */}
            {roleChoices.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <span id="staff-role-hint" className="field-hint">
            {ROLE_DESCRIPTION[form.role]}
          </span>
        </div>

        {showPropertyPicker && (
          <fieldset className="staff-properties" disabled={!editable || saving}>
            <legend>Property access</legend>
            {properties.length === 0 ? (
              <p className="field-hint">
                No properties yet. Create one first, then come back to grant access.
              </p>
            ) : (
              <>
                <p className="field-hint">
                  {ROLE_LABEL[form.role]}s reach only the properties selected here.
                </p>
                <div className="staff-property-list">
                  {properties.map((property) => (
                    <label key={property.id} className="staff-property-option">
                      <input
                        type="checkbox"
                        checked={form.propertyIds.includes(property.id)}
                        onChange={() => togglePropertyAccess(property.id)}
                      />
                      <span>{property.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
        )}

        {!showPropertyPicker && (
          <p className="field-hint">{ROLE_LABEL[form.role]}s already reach every property in your organization.</p>
        )}
      </form>
    </Modal>
  );
}

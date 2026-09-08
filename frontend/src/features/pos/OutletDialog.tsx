import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createOutlet } from './api';
import { OUTLET_TYPES, OUTLET_TYPE_LABEL } from './types';

interface OutletDialogProps {
  propertyId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create a point-of-sale outlet. Deliberately create-only: renaming or
 * retiring an outlet is a rarer, more consequential act (it has historical
 * orders) and belongs to an outlet-management flow, not this quick-add.
 */
export function OutletDialog({ propertyId, onClose, onSaved }: OutletDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('OTHER');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createOutlet(propertyId, { name: name.trim(), type });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the outlet.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New outlet"
      description="A restaurant, bar, spa, minibar or other point of sale."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="outlet-form" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create outlet'}
          </button>
        </>
      }
    >
      <form id="outlet-form" onSubmit={onSubmit} className="form-grid">
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {OUTLET_TYPES.map((t) => (
              <option key={t} value={t}>
                {OUTLET_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, apiFetch } from '../lib/api';
import './resource-pages.css';

interface Property {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

const emptyForm = { name: '', slug: '' };

export function PropertiesPage() {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // A brief, self-clearing confirmation rather than a persistent banner —
  // the updated list itself is the lasting evidence the action worked.
  function flashSuccess(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3500);
  }

  async function load() {
    try {
      const res = await apiFetch<{ properties: Property[] }>('/api/v1/properties');
      setProperties(res.properties);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load properties.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<{ property: Property }>('/api/v1/properties', { method: 'POST', body: form });
      setForm(emptyForm);
      await load();
      flashSuccess(`"${created.property.name}" was added.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create property.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm('Delete this property and all of its rooms? This cannot be undone.')) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/properties/${id}`, { method: 'DELETE' });
      await load();
      flashSuccess(`"${name}" was deleted.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete property.');
    }
  }

  return (
    <section>
      <h1>Properties</h1>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="page-success" role="status">
          {success}
        </p>
      )}

      <form className="inline-form" onSubmit={(event) => void handleCreate(event)}>
        <input
          placeholder="Name (e.g. Main House)"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <input
          placeholder="Slug (e.g. main-house)"
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="Lowercase letters, numbers, and hyphens only"
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add property'}
        </button>
      </form>

      {properties === null ? (
        <p className="page-loading" role="status">
          Loading…
        </p>
      ) : properties.length === 0 ? (
        <p className="empty-state">No properties yet — add your first one above.</p>
      ) : (
        <ul className="resource-list">
          {properties.map((property) => (
            <li key={property.id}>
              <div>
                <strong>{property.name}</strong>
                <span className="muted">
                  {' '}
                  /{property.slug} · {property.timezone}
                </span>
              </div>
              <div className="resource-actions">
                <Link to={`/app/properties/${property.id}/rooms`}>Manage rooms</Link>
                <button type="button" className="danger" onClick={() => void handleDelete(property.id, property.name)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

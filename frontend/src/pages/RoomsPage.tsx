import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, apiFetch } from '../lib/api';
import './resource-pages.css';

type RoomStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

interface Room {
  id: string;
  name: string;
  roomType: string;
  capacity: number;
  status: RoomStatus;
}

interface Property {
  id: string;
  name: string;
}

const emptyForm = { name: '', roomType: '', capacity: '1' };

export function RoomsPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!propertyId) return;
    try {
      const [propertyRes, roomsRes] = await Promise.all([
        apiFetch<{ property: Property }>(`/api/v1/properties/${propertyId}`),
        apiFetch<{ rooms: Room[] }>(`/api/v1/properties/${propertyId}/rooms`),
      ]);
      setProperty(propertyRes.property);
      setRooms(roomsRes.rooms);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load rooms.');
    }
  }

  useEffect(() => {
    void load();
    // Reload whenever the route's :propertyId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!propertyId) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/properties/${propertyId}/rooms`, {
        method: 'POST',
        body: { name: form.name, roomType: form.roomType, capacity: Number(form.capacity) },
      });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create room.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!propertyId || !confirm('Delete this room?')) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/properties/${propertyId}/rooms/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete room.');
    }
  }

  async function handleStatusChange(id: string, status: RoomStatus) {
    if (!propertyId) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/properties/${propertyId}/rooms/${id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update room.');
    }
  }

  return (
    <section>
      <p>
        <Link to="/app/properties">&larr; Properties</Link>
      </p>
      <h1>Rooms{property ? ` — ${property.name}` : ''}</h1>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <form className="inline-form" onSubmit={(event) => void handleCreate(event)}>
        <input
          placeholder="Name (e.g. 101)"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <input
          placeholder="Room type (e.g. Deluxe King)"
          value={form.roomType}
          onChange={(e) => setForm((f) => ({ ...f, roomType: e.target.value }))}
          required
        />
        <input
          type="number"
          min={1}
          placeholder="Capacity"
          value={form.capacity}
          onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add room'}
        </button>
      </form>

      {rooms === null ? (
        <p>Loading…</p>
      ) : rooms.length === 0 ? (
        <p className="empty-state">No rooms yet — add your first one above.</p>
      ) : (
        <ul className="resource-list">
          {rooms.map((room) => (
            <li key={room.id}>
              <div>
                <strong>{room.name}</strong>
                <span className="muted">
                  {' '}
                  · {room.roomType} · sleeps {room.capacity}
                </span>
              </div>
              <div className="resource-actions">
                <select
                  value={room.status}
                  onChange={(e) => void handleStatusChange(room.id, e.target.value as RoomStatus)}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="MAINTENANCE">Maintenance</option>
                </select>
                <button type="button" className="danger" onClick={() => void handleDelete(room.id)}>
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

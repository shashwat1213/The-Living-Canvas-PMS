import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { hasPermission } from '../../auth/session';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { formatMinor } from '../rate-plans/money';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { cancelReservationGroup, getReservationGroup, listReservationGroups } from './api';
import { NewBlockDialog } from './NewBlockDialog';
import type { ReservationGroupDetail, ReservationGroupSummary } from './types';
import './reservation-groups.css';

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'In-house',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export function GroupsPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [groups, setGroups] = useState<ReservationGroupSummary[] | null>(null);
  const [selected, setSelected] = useState<ReservationGroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const mayRead = hasPermission(session, 'reservations:read');
  const mayManage = hasPermission(session, 'reservations:manage');

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      const result = await listReservationGroups(propertyId);
      setGroups(result);
      setError(null);
    } catch (err) {
      setGroups([]);
      setError(err instanceof ApiError ? err.message : 'Could not load blocks.');
    }
  }, [propertyId]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [propertyId]);

  async function openDetail(id: string) {
    if (!propertyId) return;
    try {
      const group = await getReservationGroup(propertyId, id);
      setSelected(group);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the block.');
    }
  }

  async function handleCancel() {
    if (!propertyId || !selected) return;
    setCancelling(true);
    try {
      const updated = await cancelReservationGroup(propertyId, selected.id);
      setSelected(updated);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the block.');
    } finally {
      setCancelling(false);
    }
  }

  if (!mayRead) {
    return (
      <section className="groups-page">
        <h1>Block bookings</h1>
        <p className="empty-state">
          You don&apos;t have access to reservations. An owner or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const activeChildren = selected?.reservations.filter((r) => r.status === 'CONFIRMED' || r.status === 'CHECKED_IN') ?? [];

  return (
    <section className="groups-page">
      <p className="groups-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="groups-header">
        <div>
          <h1>Block bookings{property ? ` — ${property.name}` : ''}</h1>
          <p className="groups-subtitle">
            Several rooms held together under one name — weddings, corporate blocks, tour groups.
          </p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            New block
          </button>
        )}
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {groups === null ? (
        <p className="empty-state">Loading blocks…</p>
      ) : groups.length === 0 ? (
        <p className="empty-state">
          No blocks yet.{mayManage ? ' Create one to hold several rooms under a single party.' : ''}
        </p>
      ) : (
        <div className="groups-grid">
          {groups.map((g) => (
            <button type="button" key={g.id} className="group-card" onClick={() => void openDetail(g.id)}>
              <div className="group-card-head">
                <span className="group-card-name">{g.name}</span>
                <span className="group-card-ref">{g.reference}</span>
              </div>
              <div className="group-card-meta">
                <span className="group-card-count">
                  {g.roomCount} room{g.roomCount === 1 ? '' : 's'}
                </span>
                {g.contactGuest && (
                  <span className="group-card-contact">
                    {g.contactGuest.firstName} {g.contactGuest.lastName}
                  </span>
                )}
              </div>
              {g.notes && <p className="group-card-notes">{g.notes}</p>}
            </button>
          ))}
        </div>
      )}

      {creating && propertyId && (
        <NewBlockDialog
          propertyId={propertyId}
          onClose={() => setCreating(false)}
          onCreated={(group) => {
            setCreating(false);
            setSelected(group);
            void load();
          }}
        />
      )}

      {selected && (
        <div className="group-detail-backdrop" role="dialog" aria-modal="true" aria-label="Block details" onClick={() => setSelected(null)}>
          <div className="group-detail" onClick={(e) => e.stopPropagation()}>
            <header className="group-detail-head">
              <div>
                <h2>{selected.name}</h2>
                <span className="group-detail-ref">{selected.reference}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} aria-label="Close">
                ✕
              </button>
            </header>

            <div className="group-detail-summary">
              <span>
                {selected.reservations.length} room{selected.reservations.length === 1 ? '' : 's'}
              </span>
              <span className="group-detail-total">{formatMinor(selected.totalAmountMinor)}</span>
            </div>

            {selected.notes && <p className="group-detail-notes">{selected.notes}</p>}

            <div className="group-detail-rooms">
              {selected.reservations.map((r) => (
                <div className={`group-room-row group-room-${r.status.toLowerCase()}`} key={r.id}>
                  <div className="group-room-main">
                    <span className="group-room-guest">
                      {r.guest.firstName} {r.guest.lastName}
                    </span>
                    <span className="group-room-type">
                      {r.roomType.name}
                      {r.room ? ` · Room ${r.room.name}` : ''}
                    </span>
                  </div>
                  <div className="group-room-side">
                    <span className="group-room-dates">
                      {r.checkIn} → {r.checkOut}
                    </span>
                    <span className={`group-room-status group-status-${r.status.toLowerCase()}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="group-room-amount">{formatMinor(r.totalAmountMinor)}</span>
                  </div>
                </div>
              ))}
            </div>

            {mayManage && activeChildren.length > 0 && (
              <footer className="group-detail-foot">
                <button type="button" className="btn btn-danger" onClick={() => void handleCancel()} disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : `Cancel block (${activeChildren.length} active)`}
                </button>
              </footer>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

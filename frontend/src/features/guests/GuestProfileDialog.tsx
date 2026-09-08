import { useCallback, useEffect, useState } from 'react';

import { Badge, type BadgeTone } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { formatMinor } from '../rate-plans/money';
import { getGuestProfile, setGuestTags } from './api';
import { guestFullName, type Guest, type GuestProfile } from './types';

interface GuestProfileDialogProps {
  guest: Guest;
  /** Whether the current user may edit tags (guests:manage). */
  canManage: boolean;
  onClose: () => void;
  /** Called when tags change so the list can refresh the row. */
  onTagsChanged: (updated: Guest) => void;
}

const STAY_STATUS_TONE: Record<string, BadgeTone> = {
  CONFIRMED: 'positive',
  CHECKED_IN: 'accent',
  CHECKED_OUT: 'muted',
  CANCELLED: 'neutral',
  NO_SHOW: 'neutral',
};

const STAY_STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The guest-360 view: lifetime stats, a tag editor, and the full stay history.
 * Read-only except for tags (gated on guests:manage). All money is formatted
 * from integer paise; every figure is computed server-side.
 */
export function GuestProfileDialog({ guest, canManage, onClose, onTagsChanged }: GuestProfileDialogProps) {
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(guest.tags);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getGuestProfile(guest.id);
      setProfile(result);
      setTags(result.guest.tags);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the guest profile.');
    }
  }, [guest.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function addTag() {
    const next = tagInput.trim().toUpperCase();
    if (!next || tags.includes(next)) {
      setTagInput('');
      return;
    }
    setTags((current) => [...current, next]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((t) => t !== tag));
  }

  async function saveTags() {
    setSavingTags(true);
    try {
      const updated = await setGuestTags(guest.id, tags);
      setTags(updated.tags);
      onTagsChanged(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save tags.');
    } finally {
      setSavingTags(false);
    }
  }

  const s = profile?.stats;
  const tagsDirty =
    tags.length !== guest.tags.length || tags.some((t, i) => t !== guest.tags[i]);

  return (
    <Modal
      title={guestFullName(guest)}
      description={guest.email ?? guest.phone ?? 'Guest profile'}
      onClose={onClose}
      size="wide"
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {/* Tags */}
      <section className="guest-profile-section">
        <h3>
          Tags
          {profile?.stats.isRepeatGuest && <Badge tone="positive">Repeat guest</Badge>}
        </h3>
        <div className="guest-tags">
          {tags.length === 0 && <span className="guest-tags-empty">No tags yet.</span>}
          {tags.map((tag) => (
            <span key={tag} className="guest-tag">
              {tag}
              {canManage && (
                <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {canManage && (
          <div className="guest-tags-edit">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Add a tag (e.g. VIP)"
              maxLength={40}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addTag} disabled={!tagInput.trim()}>
              Add
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveTags} disabled={!tagsDirty || savingTags}>
              {savingTags ? 'Saving…' : 'Save tags'}
            </button>
          </div>
        )}
      </section>

      {/* Lifetime stats */}
      {s && (
        <section className="guest-profile-section">
          <h3>Lifetime</h3>
          <dl className="guest-stats">
            <div><dt>Total stays</dt><dd>{s.totalStays}</dd></div>
            <div><dt>Nights stayed</dt><dd>{s.nightsStayed}</dd></div>
            <div><dt>Upcoming</dt><dd>{s.upcomingStays}</dd></div>
            <div><dt>Cancelled</dt><dd>{s.cancelledStays}</dd></div>
            <div><dt>Booked value</dt><dd>{formatMinor(s.bookedValueMinor)}</dd></div>
            <div><dt>Charged</dt><dd>{formatMinor(s.chargedMinor)}</dd></div>
            <div><dt>Paid</dt><dd>{formatMinor(s.paidMinor)}</dd></div>
            <div><dt>Balance</dt><dd>{formatMinor(s.balanceMinor)}</dd></div>
            <div><dt>First stay</dt><dd>{formatDate(s.firstStay)}</dd></div>
            <div><dt>Last stay</dt><dd>{formatDate(s.lastStay)}</dd></div>
          </dl>
        </section>
      )}

      {/* Stay history */}
      <section className="guest-profile-section">
        <h3>Stay history</h3>
        {!profile ? (
          <p className="empty-state">Loading…</p>
        ) : profile.stays.length === 0 ? (
          <p className="empty-state">No stays on record.</p>
        ) : (
          <table className="guest-stays">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Property</th>
                <th scope="col">Dates</th>
                <th scope="col" className="guest-num">Nights</th>
                <th scope="col">Status</th>
                <th scope="col" className="guest-num">Value</th>
              </tr>
            </thead>
            <tbody>
              {profile.stays.map((st) => (
                <tr key={st.id}>
                  <td>{st.reference}</td>
                  <td>{st.property.name}</td>
                  <td>{formatDate(st.checkIn)} → {formatDate(st.checkOut)}</td>
                  <td className="guest-num">{st.nights}</td>
                  <td>
                    <Badge tone={STAY_STATUS_TONE[st.status] ?? 'neutral'}>
                      {STAY_STATUS_LABEL[st.status] ?? st.status}
                    </Badge>
                  </td>
                  <td className="guest-num">{formatMinor(st.totalAmountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Modal>
  );
}

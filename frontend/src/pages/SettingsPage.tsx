import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { ApiError, apiFetch } from '../lib/api';
import { setFlash } from '../lib/flash';
import { useProfile } from '../lib/profile';
import './settings.css';

/**
 * Account settings: profile summary, email verification status (with a
 * resend action), password reset entry point, and the "danger zone"
 * self-service account deletion required by GDPR/DPDP-style rules.
 */
export function SettingsPage() {
  const { profile, error: loadError, reload } = useProfile();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    document.title = 'Account settings · The Living Canvas';
  }, []);

  async function resend() {
    setResendState('sending');
    setResendError(null);
    try {
      await apiFetch('/api/v1/auth/resend-verification', { method: 'POST' });
      setResendState('sent');
    } catch (err) {
      setResendError(err instanceof ApiError ? err.message : 'Could not send the email.');
      setResendState('error');
    }
  }

  if (loadError) {
    return (
      <section className="settings">
        <h1>Account settings</h1>
        <p className="page-error" role="alert">
          {loadError}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            Retry
          </button>
        </p>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="settings">
        <h1>Account settings</h1>
        <div className="skeleton-stack" role="status" aria-label="Loading settings">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </section>
    );
  }

  const verified = Boolean(profile.emailVerifiedAt);

  return (
    <section className="settings">
      <header className="settings-head">
        <h1>Account settings</h1>
        <p>Manage your profile, security and data.</p>
      </header>

      <div className="settings-card">
        <h2>Profile</h2>
        <dl className="settings-dl">
          <div>
            <dt>Name</dt>
            <dd>
              {profile.firstName} {profile.lastName}
            </dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>
              {profile.email}{' '}
              <span className={`badge ${verified ? 'badge-positive' : 'badge-warning'}`}>
                {verified ? 'Verified' : 'Not verified'}
              </span>
            </dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{profile.role.charAt(0) + profile.role.slice(1).toLowerCase()}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{profile.organization.name}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{new Date(profile.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd>
          </div>
        </dl>
      </div>

      {!verified && (
        <div className="settings-card">
          <h2>Verify your email</h2>
          <p className="settings-muted">
            We sent a confirmation link to <strong>{profile.email}</strong>. Verifying lets us send booking alerts and
            password resets to you safely.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void resend()} disabled={resendState === 'sending' || resendState === 'sent'}>
            {resendState === 'sending' ? 'Sending…' : resendState === 'sent' ? 'Sent — check your inbox' : 'Resend verification email'}
          </button>
          {resendError && (
            <p className="page-error" role="alert">
              {resendError}
            </p>
          )}
        </div>
      )}

      <div className="settings-card">
        <h2>Password</h2>
        <p className="settings-muted">
          To change your password we’ll email you a secure reset link. You’ll be signed out everywhere afterwards.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={profile.isDemo}
          title={profile.isDemo ? 'Disabled on the shared demo account' : undefined}
          onClick={() => navigate('/forgot-password')}
        >
          Change password
        </button>
      </div>

      <div className="settings-card settings-danger">
        <h2>Delete account</h2>
        <p className="settings-muted">
          {profile.role === 'OWNER'
            ? 'As the owner, deleting your account permanently deletes the whole organization — every property, room, booking, guest record and report. This cannot be undone.'
            : 'Permanently deletes your user account. Your organization’s data stays with the organization.'}
        </p>
        {profile.isDemo ? (
          <p className="settings-muted">
            <em>This is the shared demo workspace, so it can’t be deleted. Create your own account to try this.</em>
          </p>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
            Delete my account
          </button>
        )}
      </div>

      {deleteOpen && (
        <DeleteAccountDialog
          owner={profile.role === 'OWNER'}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setFlash('Your account has been deleted. Sorry to see you go.');
            void logout();
          }}
        />
      )}
    </section>
  );
}

function DeleteAccountDialog({ owner, onClose, onDeleted }: { owner: boolean; onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/api/v1/auth/account', { method: 'DELETE', body: { password, confirm } });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the account.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Delete account permanently?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="delete-account-form" className="btn btn-danger" disabled={busy || confirm !== 'DELETE' || !password}>
            {busy ? 'Deleting…' : 'Delete forever'}
          </button>
        </>
      }
    >
      <form id="delete-account-form" onSubmit={(e) => void submit(e)} className="settings-delete-form" noValidate>
        <p>
          {owner
            ? 'This deletes your organization and all of its data. There is no undo and no backup restore for individual accounts.'
            : 'This deletes your user account. There is no undo.'}
        </p>
        <FormField label="Your password" revealable value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <FormField
          label='Type "DELETE" to confirm'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          placeholder="DELETE"
        />
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

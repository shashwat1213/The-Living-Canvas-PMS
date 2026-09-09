import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { ApiError, apiFetch } from '../lib/api';
import './auth-pages.css';

interface SignupForm {
  organizationName: string;
  organizationSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

const emptyForm: SignupForm = {
  organizationName: '',
  organizationSlug: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
};

export function SignupPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<SignupForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/app/properties" replace />;
  }

  function update<K extends keyof SignupForm>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/organizations', {
        method: 'POST',
        body: {
          organizationName: form.organizationName,
          organizationSlug: form.organizationSlug,
          owner: {
            email: form.email,
            password: form.password,
            firstName: form.firstName,
            lastName: form.lastName,
          },
        },
      });
      await login(form.email, form.password);
      navigate('/app/properties');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" />
              <path d="M5 21V7l7-4 7 4v14" />
              <path d="M9 21v-6h6v6" />
            </svg>
          </span>
          <span className="auth-brand-name">The Living Canvas</span>
        </div>
        <h1>Create your organization</h1>
        <p className="auth-subtitle">Set up your hotel workspace in a minute</p>
        <label>
          Organization name
          <input value={form.organizationName} onChange={(e) => update('organizationName', e.target.value)} required />
        </label>
        <label>
          Organization URL slug
          <input
            value={form.organizationSlug}
            onChange={(e) => update('organizationSlug', e.target.value)}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers, and hyphens only"
          />
        </label>
        <label>
          Your first name
          <input value={form.firstName} onChange={(e) => update('firstName', e.target.value)} required />
        </label>
        <label>
          Your last name
          <input value={form.lastName} onChange={(e) => update('lastName', e.target.value)} required />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create organization'}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}

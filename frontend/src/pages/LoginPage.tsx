import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { ApiError } from '../lib/api';
import './auth-pages.css';

const DEMO_EMAIL = 'owner@grandpalace.com';
const DEMO_PASSWORD = 'Password123';

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/app/properties" replace />;
  }

  async function submit(nextEmail: string, nextPassword: string) {
    setError(null);
    setSubmitting(true);
    try {
      await login(nextEmail, nextPassword);
      navigate('/app/properties');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(email, password);
  }

  function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    void submit(DEMO_EMAIL, DEMO_PASSWORD);
  }

  return (
    <main className="auth-page">
      {/* Left: branded product showcase (Mews/Cloudbeds-class front door) */}
      <aside className="auth-hero" aria-hidden="true">
        <div className="auth-hero-glow" />
        <div className="auth-hero-grid" />
        <div className="auth-hero-top">
          <span className="auth-hero-mark">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" />
              <path d="M5 21V7l7-4 7 4v14" />
              <path d="M9 21v-6h6v6" />
            </svg>
          </span>
          <span className="auth-hero-brand">The Living Canvas</span>
        </div>

        <div className="auth-hero-body">
          <h2 className="auth-hero-headline">
            Run every property<br />from one calm workspace.
          </h2>
          <p className="auth-hero-sub">
            Reservations, front desk, housekeeping, POS, revenue and AI marketing —
            the complete hospitality platform for modern hotels.
          </p>

          <div className="auth-hero-stats">
            <div className="auth-hero-stat">
              <span className="auth-hero-stat-num">19</span>
              <span className="auth-hero-stat-label">Connected modules</span>
            </div>
            <div className="auth-hero-stat">
              <span className="auth-hero-stat-num">Real-time</span>
              <span className="auth-hero-stat-label">Occupancy &amp; revenue</span>
            </div>
            <div className="auth-hero-stat">
              <span className="auth-hero-stat-num">Multi</span>
              <span className="auth-hero-stat-label">Property &amp; tenant</span>
            </div>
          </div>
        </div>

        <p className="auth-hero-foot">Trusted operations, from front desk to boardroom.</p>
      </aside>

      {/* Right: sign-in form */}
      <div className="auth-panel">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-brand auth-brand-mobile">
            <span className="auth-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 21v-6h6v6" />
              </svg>
            </span>
            <span className="auth-brand-name">The Living Canvas</span>
          </div>

          <h1>Welcome back</h1>
          <p className="auth-subtitle">Sign in to your property management workspace</p>

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="you@hotel.com"
            />
          </label>

          <label>
            Password
            <span className="auth-password">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Log in'}
          </button>

          <div className="auth-divider"><span>or</span></div>

          <button
            type="button"
            className="auth-demo"
            onClick={fillDemo}
            disabled={submitting}
          >
            ✨ Explore the live demo
          </button>

          <p className="auth-switch">
            New organization? <Link to="/signup">Create one</Link>
          </p>
        </form>
      </div>
    </main>
  );
}

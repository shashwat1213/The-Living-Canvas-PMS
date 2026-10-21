import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { FormField } from '../components/FormField';
import { ApiError } from '../lib/api';
import { takeFlash } from '../lib/flash';
import { validateEmail } from '../lib/validation';
import { AuthLayout } from './AuthLayout';

// Public demo workspace (seeded with a realistic hotel). Overridable per
// deployment; the backend blocks deleting / password-resetting this account.
const DEMO_EMAIL = (import.meta.env.VITE_DEMO_EMAIL as string | undefined) ?? 'owner@grandpalace.com';
const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? 'Password123';

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { notice?: string; demo?: boolean; from?: string } | null;
  const [flash] = useState(() => takeFlash());
  const notice = routeState?.notice ?? flash;
  const returnTo = routeState?.from?.startsWith('/app') ? routeState.from : '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const autoDemoStarted = useRef(false);

  useEffect(() => {
    document.title = 'Log in · The Living Canvas';
  }, []);

  // "Try the live demo" on the landing page arrives here with state.demo —
  // sign straight in once the silent-refresh check says nobody is logged in.
  useEffect(() => {
    if (routeState?.demo && status === 'anonymous' && !autoDemoStarted.current) {
      autoDemoStarted.current = true;
      fillDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status === 'authenticated') {
    return <Navigate to={returnTo} replace />;
  }

  async function submit(nextEmail: string, nextPassword: string) {
    setError(null);
    setSubmitting(true);
    try {
      await login(nextEmail.trim(), nextPassword);
      navigate(returnTo);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many sign-in attempts. Please wait 15 minutes, or reset your password.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      email: validateEmail(email),
      password: password ? undefined : 'Enter your password.',
    };
    setErrors(next);
    if (next.email || next.password) return;
    void submit(email, password);
  }

  function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setErrors({});
    void submit(DEMO_EMAIL, DEMO_PASSWORD);
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <h1>Welcome back</h1>
        <p className="auth-subtitle">Sign in to your property management workspace</p>

        {notice && (
          <p className="auth-notice" role="status">
            {notice}
          </p>
        )}

        <FormField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="you@hotel.com"
          error={errors.email}
        />

        <div className="auth-field-row">
          <FormField
            label="Password"
            revealable
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            error={errors.password}
          />
          <Link to="/forgot-password" className="auth-forgot">
            Forgot password?
          </Link>
        </div>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
          {submitting ? 'Signing in…' : 'Log in'}
        </button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        <button type="button" className="auth-demo" onClick={fillDemo} disabled={submitting}>
          ✨ Explore the live demo
        </button>

        <p className="auth-demo-hint">
          One click — a fully stocked demo hotel. No sign-up needed.
        </p>

        <p className="auth-switch">
          New organization? <Link to="/signup">Create one</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

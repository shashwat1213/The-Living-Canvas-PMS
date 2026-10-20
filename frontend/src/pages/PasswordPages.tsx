import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { FormField, PasswordStrength } from '../components/FormField';
import { Turnstile, captchaEnabled, captchaHeaders } from '../components/Turnstile';
import { ApiError, apiFetch, fieldError } from '../lib/api';
import { validateEmail, validatePassword } from '../lib/validation';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const invalid = validateEmail(email);
    setEmailError(invalid);
    if (invalid) return;
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the security check below.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
        headers: captchaHeaders(captchaToken),
        skipAuthRetry: true,
      });
      setSent(true);
    } catch (err) {
      setCaptchaReset((n) => n + 1);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      {sent ? (
        <div className="auth-form auth-result">
          <span className="auth-result-icon" aria-hidden="true">✉️</span>
          <h1>Check your inbox</h1>
          <p className="auth-subtitle">
            If an account exists for <strong>{email.trim()}</strong>, we’ve sent a link to reset your password. It
            expires in 1 hour.
          </p>
          <p className="auth-muted">Didn’t get it? Check spam, or try again in a few minutes.</p>
          <Link to="/login" className="auth-submit auth-link-btn">
            Back to log in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <h1>Forgot your password?</h1>
          <p className="auth-subtitle">Enter your account email and we’ll send you a reset link.</p>
          <FormField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(undefined);
            }}
            autoComplete="email"
            placeholder="you@hotel.com"
            error={emailError}
          />
          <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="auth-switch">
            Remembered it? <Link to="/login">Log in</Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const next = {
      password: validatePassword(password),
      confirm: confirm === password ? undefined : 'Passwords don’t match.',
    };
    setErrors(next);
    if (next.password || next.confirm) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token, password },
        skipAuthRetry: true,
      });
      navigate('/login', { replace: true, state: { notice: 'Password updated. Log in with your new password.' } });
    } catch (err) {
      const pw = fieldError(err, 'password');
      if (pw) setErrors({ password: pw });
      else setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="auth-form auth-result">
          <span className="auth-result-icon" aria-hidden="true">⚠️</span>
          <h1>Link is incomplete</h1>
          <p className="auth-subtitle">This reset link is missing its code. Open the link from your email again, or request a new one.</p>
          <Link to="/forgot-password" className="auth-submit auth-link-btn">
            Request a new link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <h1>Choose a new password</h1>
        <p className="auth-subtitle">You’ll be signed out of every other device.</p>
        <div>
          <FormField
            label="New password"
            revealable
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            error={errors.password}
          />
          <PasswordStrength value={password} />
        </div>
        <FormField
          label="Confirm new password"
          revealable
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          error={errors.confirm}
        />
        {error && (
          <p className="auth-error" role="alert">
            {error}{' '}
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
          {submitting ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  );
}

type VerifyState = 'verifying' | 'done' | 'failed';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { status } = useAuth();
  const [state, setState] = useState<VerifyState>(token ? 'verifying' : 'failed');
  const [message, setMessage] = useState('This verification link is incomplete.');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // StrictMode double-invoke: the token is single-use.
    apiFetch('/api/v1/auth/verify-email', { method: 'POST', body: { token }, skipAuthRetry: true })
      .then(() => setState('done'))
      .catch((err: unknown) => {
        setMessage(err instanceof ApiError ? err.message : 'We could not verify your email.');
        setState('failed');
      });
  }, [token]);

  const next = status === 'authenticated' ? '/app' : '/login';

  return (
    <AuthLayout>
      <div className="auth-form auth-result" aria-live="polite">
        {state === 'verifying' && (
          <>
            <span className="spinner spinner-lg" aria-hidden="true" />
            <h1>Verifying your email…</h1>
          </>
        )}
        {state === 'done' && (
          <>
            <span className="auth-result-icon" aria-hidden="true">✅</span>
            <h1>Email verified</h1>
            <p className="auth-subtitle">Thanks — your address is confirmed and your account is fully set up.</p>
            <Link to={next} className="auth-submit auth-link-btn">
              {status === 'authenticated' ? 'Go to dashboard' : 'Log in'}
            </Link>
          </>
        )}
        {state === 'failed' && (
          <>
            <span className="auth-result-icon" aria-hidden="true">⚠️</span>
            <h1>Couldn’t verify</h1>
            <p className="auth-subtitle">{message}</p>
            <p className="auth-muted">
              {status === 'authenticated'
                ? 'You can send a fresh link from Account settings.'
                : 'Log in and send a fresh link from Account settings.'}
            </p>
            <Link to={status === 'authenticated' ? '/app/settings' : '/login'} className="auth-submit auth-link-btn">
              {status === 'authenticated' ? 'Open settings' : 'Log in'}
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

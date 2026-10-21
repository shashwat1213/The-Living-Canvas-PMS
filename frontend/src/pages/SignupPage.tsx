import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/useAuth';
import { FormField, PasswordStrength } from '../components/FormField';
import { Turnstile, captchaEnabled, captchaHeaders } from '../components/Turnstile';
import { ApiError, apiFetch, fieldError } from '../lib/api';
import { slugify, validateEmail, validatePassword, validateRequired } from '../lib/validation';
import { AuthLayout } from './AuthLayout';

interface SignupForm {
  organizationName: string;
  organizationSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

type Errors = Partial<Record<keyof SignupForm | 'acceptTerms', string>>;

const emptyForm: SignupForm = {
  organizationName: '',
  organizationSlug: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
};

function validate(form: SignupForm, acceptTerms: boolean): Errors {
  return {
    organizationName: validateRequired(form.organizationName, 'Hotel / company name', 2),
    organizationSlug:
      validateRequired(form.organizationSlug, 'Workspace URL', 2) ??
      (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.organizationSlug)
        ? undefined
        : 'Use lowercase letters, numbers and single hyphens only.'),
    firstName: validateRequired(form.firstName, 'First name'),
    lastName: validateRequired(form.lastName, 'Last name'),
    email: validateEmail(form.email),
    password: validatePassword(form.password),
    acceptTerms: acceptTerms ? undefined : 'Please accept the Terms and Privacy Policy to continue.',
  };
}

export function SignupPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<SignupForm>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  // Set just before logging the new owner in, so the "already signed in"
  // redirect below sends a fresh signup to the setup wizard, not the dashboard.
  const [justSignedUp, setJustSignedUp] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={justSignedUp ? '/app/welcome' : '/app'} replace />;
  }

  function update<K extends keyof SignupForm>(key: K, value: string) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'organizationName' && !slugTouched) next.organizationSlug = slugify(value);
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const nextErrors = validate(form, acceptTerms);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the security check below.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/v1/organizations', {
        method: 'POST',
        headers: captchaHeaders(captchaToken),
        body: {
          organizationName: form.organizationName.trim(),
          organizationSlug: form.organizationSlug,
          acceptTerms: true,
          owner: {
            email: form.email.trim(),
            password: form.password,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
          },
        },
      });
      setJustSignedUp(true);
      await login(form.email.trim(), form.password);
      navigate('/app/welcome', { replace: true });
    } catch (err) {
      setCaptchaReset((n) => n + 1);
      if (err instanceof ApiError && err.issues) {
        setErrors({
          organizationName: fieldError(err, 'organizationName'),
          organizationSlug: fieldError(err, 'organizationSlug'),
          firstName: fieldError(err, 'firstName'),
          lastName: fieldError(err, 'lastName'),
          email: fieldError(err, 'email'),
          password: fieldError(err, 'password'),
        });
        setError('Please fix the highlighted fields.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <h1>Create your workspace</h1>
        <p className="auth-subtitle">Set up your hotel in under a minute — free, no card required.</p>

        <FormField
          label="Hotel / company name"
          value={form.organizationName}
          onChange={(e) => update('organizationName', e.target.value)}
          placeholder="Seaside Retreats"
          autoComplete="organization"
          error={errors.organizationName}
        />
        <FormField
          label="Workspace URL"
          value={form.organizationSlug}
          onChange={(e) => {
            setSlugTouched(true);
            update('organizationSlug', e.target.value.toLowerCase());
          }}
          placeholder="seaside-retreats"
          error={errors.organizationSlug}
          hint="Lowercase letters, numbers and hyphens."
        />
        <div className="auth-grid-2">
          <FormField
            label="First name"
            value={form.firstName}
            onChange={(e) => update('firstName', e.target.value)}
            autoComplete="given-name"
            error={errors.firstName}
          />
          <FormField
            label="Last name"
            value={form.lastName}
            onChange={(e) => update('lastName', e.target.value)}
            autoComplete="family-name"
            error={errors.lastName}
          />
        </div>
        <FormField
          label="Work email"
          type="email"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          autoComplete="email"
          placeholder="you@hotel.com"
          error={errors.email}
        />
        <div>
          <FormField
            label="Password"
            revealable
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            autoComplete="new-password"
            error={errors.password}
          />
          <PasswordStrength value={form.password} />
        </div>

        <label className={`auth-check ${errors.acceptTerms ? 'auth-check-invalid' : ''}`}>
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => {
              setAcceptTerms(e.target.checked);
              setErrors((x) => ({ ...x, acceptTerms: undefined }));
            }}
          />
          <span>
            I agree to the{' '}
            <Link to="/terms" target="_blank">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && (
          <span className="form-error" role="alert">
            {errors.acceptTerms}
          </span>
        )}

        <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? <span className="btn-spinner" aria-hidden="true" /> : null}
          {submitting ? 'Creating your workspace…' : 'Create workspace'}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

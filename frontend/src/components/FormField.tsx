import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

import { passwordChecks, passwordStrength } from '../lib/validation';

/**
 * Labelled input with an inline, accessible error message. Used by every
 * auth/account form so validation looks and reads the same everywhere.
 */
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Renders a show/hide toggle for password inputs. */
  revealable?: boolean;
}

export function FormField({ label, error, hint, revealable, type, id, ...input }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [revealed, setRevealed] = useState(false);
  const effectiveType = revealable ? (revealed ? 'text' : 'password') : type;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`form-field ${error ? 'form-field-invalid' : ''}`}>
      <label htmlFor={inputId}>{label}</label>
      <span className={revealable ? 'auth-password' : undefined}>
        <input
          id={inputId}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
        {revealable && (
          <button
            type="button"
            className="auth-password-toggle"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </span>
      {hint && !error && (
        <span className="form-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="form-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

const STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

export function PasswordStrength({ value }: { value: string }) {
  if (!value) return null;
  const score = passwordStrength(value);
  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-strength-bar" data-score={score}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < score ? 'on' : ''} />
        ))}
      </div>
      <ul className="pw-checks">
        {passwordChecks(value).map((c) => (
          <li key={c.label} className={c.ok ? 'ok' : ''}>
            <span aria-hidden="true">{c.ok ? '✓' : '•'}</span> {c.label}
          </li>
        ))}
        <li className="pw-label">{STRENGTH_LABELS[score]}</li>
      </ul>
    </div>
  );
}

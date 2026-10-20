/**
 * Client-side form validation. Mirrors the backend's zod rules so users get
 * instant, specific feedback — the server still validates everything.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Email is required.';
  if (!EMAIL_PATTERN.test(value.trim())) return 'Enter a valid email address, like you@hotel.com.';
  return undefined;
}

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

export function passwordChecks(value: string): PasswordCheck[] {
  return [
    { label: 'At least 8 characters', ok: value.length >= 8 },
    { label: 'Contains a letter', ok: /[A-Za-z]/.test(value) },
    { label: 'Contains a number', ok: /[0-9]/.test(value) },
  ];
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Password is required.';
  const failed = passwordChecks(value).find((c) => !c.ok);
  if (failed) return `Password needs: ${failed.label.toLowerCase()}.`;
  if (value.length > 128) return 'Password must be at most 128 characters.';
  return undefined;
}

/** 0–4 strength score for the meter (length + character variety). */
export function passwordStrength(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Za-z]/.test(value) && /[0-9]/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value))) score += 1;
  return Math.min(score, 4);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function validateRequired(value: string, label: string, min = 1): string | undefined {
  if (!value.trim()) return `${label} is required.`;
  if (value.trim().length < min) return `${label} must be at least ${min} characters.`;
  return undefined;
}

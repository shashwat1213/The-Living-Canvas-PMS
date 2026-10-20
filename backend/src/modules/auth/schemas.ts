import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Shared password policy: signup, reset, staff creation. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.');

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });

export const forgotPasswordSchema = z.object({ email: z.string().trim().email('Enter a valid email address.') });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.'),
  confirm: z.literal('DELETE', { message: 'Type DELETE to confirm.' }),
});

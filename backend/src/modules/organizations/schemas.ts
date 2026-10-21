import { z } from 'zod';

import { SLUG_PATTERN, SLUG_PATTERN_MESSAGE } from '../../lib/slug.js';
import { passwordSchema } from '../auth/schemas.js';

export const createOrganizationSchema = z.object({
  organizationName: z.string().trim().min(2, 'Hotel name must be at least 2 characters.').max(120),
  organizationSlug: z.string().trim().min(2).max(60).regex(SLUG_PATTERN, SLUG_PATTERN_MESSAGE),
  owner: z.object({
    email: z.string().trim().email('Enter a valid email address.'),
    password: passwordSchema,
    firstName: z.string().trim().min(1, 'First name is required.').max(80),
    lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  }),
  /** Explicit consent to the Terms + Privacy Policy (required by the signup form). */
  acceptTerms: z.literal(true, { message: 'Please accept the Terms and Privacy Policy.' }).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().min(2).max(120),
  })
  .partial();

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

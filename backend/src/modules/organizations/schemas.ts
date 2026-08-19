import { z } from 'zod';

import { SLUG_PATTERN, SLUG_PATTERN_MESSAGE } from '../../lib/slug.js';

export const createOrganizationSchema = z.object({
  organizationName: z.string().min(2).max(120),
  organizationSlug: z.string().min(2).max(60).regex(SLUG_PATTERN, SLUG_PATTERN_MESSAGE),
  owner: z.object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
  }),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().min(2).max(120),
  })
  .partial();

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

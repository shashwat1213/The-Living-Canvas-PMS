import { z } from 'zod';

import { SLUG_PATTERN, SLUG_PATTERN_MESSAGE } from '../../lib/slug.js';

export const createPropertySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(SLUG_PATTERN, SLUG_PATTERN_MESSAGE),
  timezone: z.string().min(1).max(60).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

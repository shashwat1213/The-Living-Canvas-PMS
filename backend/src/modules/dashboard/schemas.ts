import { z } from 'zod';

/**
 * The dashboard is read for a single calendar date (defaulting to today).
 * Arrivals, departures and stayovers are all computed relative to this date.
 * Date-only, consistent with the project's stay-date convention.
 */
export const dashboardQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD.')
    .optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

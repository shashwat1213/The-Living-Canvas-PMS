import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/**
 * A short operational code ("BAR", "NR", "AP14"). Upper-cased on the way in
 * so the per-room-type uniqueness constraint can't be sidestepped by casing —
 * the same treatment `RoomType.code` gets.
 */
const ratePlanCode = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or hyphens only.')
  .transform((value) => value.toUpperCase());

export const createRatePlanSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: ratePlanCode.optional(),
  description: z.string().trim().max(1000).optional(),
  isRefundable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type CreateRatePlanInput = z.infer<typeof createRatePlanSchema>;

/**
 * Update mirrors `room-types`: `code` and `description` are `.nullable()` so a
 * previously-set value can be cleared with an explicit `null`, while an
 * omitted key means "leave unchanged". At least one field is required.
 */
export const updateRatePlanSchema = createRatePlanSchema
  .extend({
    code: ratePlanCode.nullable(),
    description: z.string().trim().max(1000).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update.' });

export type UpdateRatePlanInput = z.infer<typeof updateRatePlanSchema>;

export const listRatePlansQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type ListRatePlansQuery = z.infer<typeof listRatePlansQuerySchema>;

/**
 * A calendar date with no time component. Query strings and JSON bodies carry
 * dates as `YYYY-MD-DD` strings; this parses one into a UTC-midnight `Date`
 * so a stay night is the same instant regardless of the server's timezone —
 * consistent with the project's date-only stay-date decision. Rejecting a
 * malformed or non-calendar value here (rather than letting Prisma coerce it)
 * keeps the "garbage in" failure at the edge.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD).')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'Not a valid calendar date.' });

/**
 * The window read by the rate calendar. Both bounds inclusive. Capped at a
 * year so a single request can't ask the server to build an unbounded grid.
 */
export const listRatesQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: '`to` must be on or after `from`.' })
  .refine((v) => (v.to.getTime() - v.from.getTime()) / 86_400_000 <= 366, {
    message: 'Date range must be one year or less.',
  });

export type ListRatesQuery = z.infer<typeof listRatesQuerySchema>;

/**
 * A bulk rate edit — the operation a revenue manager actually performs:
 * "set this plan to ₹4,500 for these dates". Prices are INR minor units
 * (paise), integer and non-negative. `amountMinor: null` for a date clears
 * its rate (that night becomes unpriced / not sellable on this plan). Up to
 * 366 dates in one call, matching the read window.
 */
export const setRatesSchema = z.object({
  rates: z
    .array(
      z.object({
        date: isoDate,
        amountMinor: z.number().int().min(0).max(1_000_000_00).nullable(),
      }),
    )
    .min(1)
    .max(366),
});

export type SetRatesInput = z.infer<typeof setRatesSchema>;

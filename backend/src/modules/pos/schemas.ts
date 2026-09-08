import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/** INR paise: a non-negative integer amount of money. */
const minorAmount = z.number().int().min(0).max(1_000_000_000);

// ---------- Outlets ----------

export const OUTLET_TYPES = [
  'RESTAURANT',
  'BAR',
  'CAFE',
  'SPA',
  'MINIBAR',
  'GIFT_SHOP',
  'ROOM_SERVICE',
  'OTHER',
] as const;

export const createOutletSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(OUTLET_TYPES).optional(),
});

export const updateOutletSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(OUTLET_TYPES),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const listOutletsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// ---------- Products ----------

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(40).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  priceMinor: minorAmount,
  trackStock: z.boolean().optional(),
  stockQty: z.number().int().min(0).max(1_000_000).optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Nullable so a caller can clear an optional field, not just omit it.
    sku: z.string().trim().min(1).max(40).nullable(),
    category: z.string().trim().min(1).max(80).nullable(),
    priceMinor: minorAmount,
    trackStock: z.boolean(),
    stockQty: z.number().int().min(0).max(1_000_000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// ---------- Orders ----------

/** A line on a new order: a product and how many. Price comes from the catalogue. */
const orderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
});

/**
 * Creating an order. It carries its outlet and at least one line, and a
 * settlement instruction:
 *  - `ROOM_CHARGE` with a `reservationId` posts the total to that booking's
 *    folio as a single charge;
 *  - `DIRECT` with a `paymentMethod` records an over-the-counter sale;
 *  - omitting settlement leaves the order OPEN (a tab to be settled later).
 * Cross-field consistency is enforced with refinements so an impossible
 * combination (e.g. ROOM_CHARGE without a reservation) is a 400.
 */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;

export const createOrderSchema = z
  .object({
    outletId: z.string().uuid(),
    items: z.array(orderItemSchema).min(1).max(100),
    settlement: z.enum(['ROOM_CHARGE', 'DIRECT']).optional(),
    reservationId: z.string().uuid().optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.settlement !== 'ROOM_CHARGE' || !!v.reservationId, {
    message: 'A room-charge order requires a reservationId.',
    path: ['reservationId'],
  })
  .refine((v) => v.settlement !== 'DIRECT' || !!v.paymentMethod, {
    message: 'A direct-paid order requires a paymentMethod.',
    path: ['paymentMethod'],
  });

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['OPEN', 'CHARGED', 'PAID', 'VOID']).optional(),
  outletId: z.string().uuid().optional(),
});

export type CreateOutletInput = z.infer<typeof createOutletSchema>;
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>;
export type ListOutletsQuery = z.infer<typeof listOutletsQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

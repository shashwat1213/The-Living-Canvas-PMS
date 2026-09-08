import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import {
  createOrderSchema,
  createOutletSchema,
  createProductSchema,
  listOrdersQuerySchema,
  listOutletsQuerySchema,
  listProductsQuerySchema,
  updateOutletSchema,
  updateProductSchema,
} from './schemas.js';
import * as posService from './service.js';

/**
 * A property's point-of-sale: outlets, their product catalogue and orders.
 *
 * Mounted at /properties/:propertyId/pos, so `requirePropertyAccess` runs
 * before every handler. Three permission tiers, matching how the work splits:
 *  - `pos:read` — see outlets, catalogue and orders (STAFF and up);
 *  - `pos:operate` — take and settle/void orders (STAFF and up: front line);
 *  - `pos:manage` — configure outlets and the catalogue (MANAGER and up).
 */
export const posRouter = Router({ mergeParams: true });

posRouter.use(authenticate, requirePropertyAccess());

// ----- Outlets -----
posRouter.get(
  '/outlets',
  requirePermission('pos:read'),
  asyncHandler(async (req, res) => {
    const query = listOutletsQuerySchema.parse(req.query);
    const result = await posService.listOutlets(req.params.propertyId as string, query);
    res.json(result);
  }),
);

posRouter.post(
  '/outlets',
  requirePermission('pos:manage'),
  asyncHandler(async (req, res) => {
    const input = createOutletSchema.parse(req.body);
    const outlet = await posService.createOutlet(req.params.propertyId as string, input);
    res.status(201).json({ outlet });
  }),
);

posRouter.patch(
  '/outlets/:outletId',
  requirePermission('pos:manage'),
  asyncHandler(async (req, res) => {
    const input = updateOutletSchema.parse(req.body);
    const outlet = await posService.updateOutlet(
      req.params.propertyId as string,
      req.params.outletId as string,
      input,
    );
    res.json({ outlet });
  }),
);

// ----- Products (catalogue of an outlet) -----
posRouter.get(
  '/outlets/:outletId/products',
  requirePermission('pos:read'),
  asyncHandler(async (req, res) => {
    const query = listProductsQuerySchema.parse(req.query);
    const result = await posService.listProducts(
      req.params.propertyId as string,
      req.params.outletId as string,
      query,
    );
    res.json(result);
  }),
);

posRouter.post(
  '/outlets/:outletId/products',
  requirePermission('pos:manage'),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);
    const product = await posService.createProduct(
      req.params.propertyId as string,
      req.params.outletId as string,
      input,
    );
    res.status(201).json({ product });
  }),
);

posRouter.patch(
  '/outlets/:outletId/products/:productId',
  requirePermission('pos:manage'),
  asyncHandler(async (req, res) => {
    const input = updateProductSchema.parse(req.body);
    const product = await posService.updateProduct(
      req.params.propertyId as string,
      req.params.outletId as string,
      req.params.productId as string,
      input,
    );
    res.json({ product });
  }),
);

// ----- Orders -----
posRouter.get(
  '/orders',
  requirePermission('pos:read'),
  asyncHandler(async (req, res) => {
    const query = listOrdersQuerySchema.parse(req.query);
    const result = await posService.listOrders(req.params.propertyId as string, query);
    res.json(result);
  }),
);

posRouter.get(
  '/orders/:orderId',
  requirePermission('pos:read'),
  asyncHandler(async (req, res) => {
    const order = await posService.getOrder(req.params.propertyId as string, req.params.orderId as string);
    res.json({ order });
  }),
);

posRouter.post(
  '/orders',
  requirePermission('pos:operate'),
  asyncHandler(async (req, res) => {
    const input = createOrderSchema.parse(req.body);
    const order = await posService.createOrder(req.params.propertyId as string, input);
    res.status(201).json({ order });
  }),
);

posRouter.post(
  '/orders/:orderId/void',
  requirePermission('pos:operate'),
  asyncHandler(async (req, res) => {
    const order = await posService.voidOrder(req.params.propertyId as string, req.params.orderId as string);
    res.json({ order });
  }),
);

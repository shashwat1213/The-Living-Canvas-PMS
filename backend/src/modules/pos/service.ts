import { randomUUID } from 'node:crypto';

import { BadRequestError, ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { posRepository, type PosDb, type PosOrderRow } from './repository.js';
import type {
  CreateOrderInput,
  CreateOutletInput,
  CreateProductInput,
  ListOrdersQuery,
  ListOutletsQuery,
  ListProductsQuery,
  UpdateOutletInput,
  UpdateProductInput,
} from './schemas.js';

/** A short, human order reference — "POS-3F9K2A". Collisions are retried. */
function generateReference(): string {
  return `POS-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** Cross-org property resolves to nothing → 404, like every sub-route. */
async function assertPropertyVisible(propertyId: string): Promise<void> {
  const property = await posRepository.findProperty(propertyId);
  if (!property) throw new NotFoundError('Property not found.');
}

// A folio charge is posted through the raw folio service path so its own audit
// and transaction semantics apply; here we resolve/derive only what POS owns.

// ---------- Outlet serialization ----------

interface OutletRow {
  id: string;
  propertyId: string;
  name: string;
  type: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function outletView(o: OutletRow) {
  return {
    id: o.id,
    name: o.name,
    type: o.type,
    isActive: o.isActive,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

interface ProductRow {
  id: string;
  outletId: string;
  name: string;
  sku: string | null;
  category: string | null;
  priceMinor: number;
  trackStock: boolean;
  stockQty: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function productView(p: ProductRow) {
  return {
    id: p.id,
    outletId: p.outletId,
    name: p.name,
    sku: p.sku,
    category: p.category,
    priceMinor: p.priceMinor,
    trackStock: p.trackStock,
    stockQty: p.stockQty,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function orderView(o: PosOrderRow) {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    settlement: o.settlement,
    outlet: o.outlet,
    reservation: o.reservation,
    paymentMethod: o.paymentMethod,
    totalMinor: o.totalMinor,
    folioChargeId: o.folioChargeId,
    notes: o.notes,
    settledAt: o.settledAt ? o.settledAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    items: o.items,
  };
}

// ---------- Outlets ----------

export async function listOutlets(propertyId: string, query: ListOutletsQuery) {
  await assertPropertyVisible(propertyId);
  const { items, page } = await posRepository.listOutlets(propertyId, query);
  return { outlets: (items as OutletRow[]).map(outletView), page };
}

export async function createOutlet(propertyId: string, input: CreateOutletInput) {
  await assertPropertyVisible(propertyId);

  // Proactive uniqueness check (per-property name, case-insensitive) so the
  // caller gets a clean 409 rather than relying on the DB error alone.
  const clash = await posRepository.findOutletByName(propertyId, input.name);
  if (clash) throw new ConflictError('An outlet with this name already exists at this property.');

  const outlet = await scopedPrisma.$transaction(async (tx) => {
    const created = await tx.posOutlet.create({
      data: { propertyId, name: input.name, type: input.type ?? 'OTHER' },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.POS_OUTLET_CREATED,
        entityType: AUDIT_ENTITY_TYPES.POS_OUTLET,
        entityId: created.id,
        metadata: { name: created.name, type: created.type },
      },
      tx,
    );
    return created;
  });
  return outletView(outlet as OutletRow);
}

export async function updateOutlet(propertyId: string, outletId: string, input: UpdateOutletInput) {
  await assertPropertyVisible(propertyId);
  const existing = (await posRepository.findOutlet(propertyId, outletId)) as OutletRow | null;
  if (!existing) throw new NotFoundError('Outlet not found.');

  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await posRepository.findOutletByName(propertyId, input.name);
    if (clash && clash.id !== outletId) {
      throw new ConflictError('An outlet with this name already exists at this property.');
    }
  }

  const diff = buildDiff(existing as unknown as Record<string, unknown>, input, ['name', 'type', 'isActive']);
  if (Object.keys(diff.to).length === 0) return outletView(existing);

  const updated = await scopedPrisma.$transaction(async (tx) => {
    const row = await tx.posOutlet.update({ where: { id: outletId }, data: input });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.POS_OUTLET_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.POS_OUTLET,
        entityId: outletId,
        metadata: { from: diff.from, to: diff.to },
      },
      tx,
    );
    return row;
  });
  return outletView(updated as OutletRow);
}

// ---------- Products ----------

export async function listProducts(propertyId: string, outletId: string, query: ListProductsQuery) {
  await assertPropertyVisible(propertyId);
  const outlet = await posRepository.findOutlet(propertyId, outletId);
  if (!outlet) throw new NotFoundError('Outlet not found.');
  const { items, page } = await posRepository.listProducts(outletId, query);
  return { products: (items as ProductRow[]).map(productView), page };
}

export async function createProduct(propertyId: string, outletId: string, input: CreateProductInput) {
  await assertPropertyVisible(propertyId);
  const outlet = await posRepository.findOutlet(propertyId, outletId);
  if (!outlet) throw new NotFoundError('Outlet not found.');

  const sku = input.sku ? input.sku.toUpperCase() : null;
  const product = await scopedPrisma.$transaction(async (tx) => {
    const created = await tx.posProduct.create({
      data: {
        outletId,
        name: input.name,
        sku,
        category: input.category ?? null,
        priceMinor: input.priceMinor,
        trackStock: input.trackStock ?? false,
        stockQty: input.stockQty ?? 0,
      },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.POS_PRODUCT_CREATED,
        entityType: AUDIT_ENTITY_TYPES.POS_PRODUCT,
        entityId: created.id,
        metadata: { name: created.name, priceMinor: created.priceMinor, outletId },
      },
      tx,
    );
    return created;
  });
  return productView(product as ProductRow);
}

export async function updateProduct(
  propertyId: string,
  outletId: string,
  productId: string,
  input: UpdateProductInput,
) {
  await assertPropertyVisible(propertyId);
  const outlet = await posRepository.findOutlet(propertyId, outletId);
  if (!outlet) throw new NotFoundError('Outlet not found.');
  const existing = (await posRepository.findProduct(outletId, productId)) as ProductRow | null;
  if (!existing) throw new NotFoundError('Product not found.');

  const data: Record<string, unknown> = { ...input };
  if (typeof input.sku === 'string') data.sku = input.sku.toUpperCase();

  const diff = buildDiff(existing as unknown as Record<string, unknown>, data, ['name', 'sku', 'category', 'priceMinor', 'trackStock', 'stockQty', 'isActive']);
  if (Object.keys(diff.to).length === 0) return productView(existing);

  const updated = await scopedPrisma.$transaction(async (tx) => {
    const row = await tx.posProduct.update({ where: { id: productId }, data: data as never });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.POS_PRODUCT_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.POS_PRODUCT,
        entityId: productId,
        metadata: { from: diff.from, to: diff.to },
      },
      tx,
    );
    return row;
  });
  return productView(updated as ProductRow);
}

// ---------- Orders ----------

export async function listOrders(propertyId: string, query: ListOrdersQuery) {
  await assertPropertyVisible(propertyId);
  const { items, page } = await posRepository.listOrders(propertyId, query);
  return { orders: items.map(orderView), page };
}

export async function getOrder(propertyId: string, orderId: string) {
  await assertPropertyVisible(propertyId);
  const order = await posRepository.findOrder(propertyId, orderId);
  if (!order) throw new NotFoundError('Order not found.');
  return orderView(order);
}

/**
 * Creates a POS order and settles it in one Serializable transaction:
 *  - resolve every line's product from the order's own outlet (cross-outlet /
 *    cross-tenant product ids are indistinguishable from nonexistent → 404),
 *  - snapshot each line's name and unit price at sale time,
 *  - decrement stock for tracked products, refusing if it would go negative,
 *  - settle: ROOM_CHARGE posts one FolioCharge to the reservation's folio;
 *    DIRECT records the tender method; neither leaves the money half-applied.
 *
 * The whole thing — order, items, stock decrements, folio charge and audit —
 * commits together, so a failure anywhere leaves no order, no charge and no
 * stock movement.
 */
export async function createOrder(propertyId: string, input: CreateOrderInput) {
  await assertPropertyVisible(propertyId);

  return scopedPrisma.$transaction(
    async (tx) => {
      const txDb = tx as unknown as PosDb;

      const outlet = await posRepository.findOutlet(propertyId, input.outletId, txDb);
      if (!outlet) throw new NotFoundError('Outlet not found.');
      if (!outlet.isActive) throw new BadRequestError('This outlet is retired and cannot take new orders.');

      // Resolve products from THIS outlet only.
      const ids = [...new Set(input.items.map((i) => i.productId))];
      const products = await posRepository.findProductsByIds(input.outletId, ids, txDb);
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const id of ids) {
        if (!byId.has(id)) throw new NotFoundError('One or more products were not found in this outlet.');
      }

      // Build line items with snapshots; accumulate stock decrements.
      const stockDelta = new Map<string, number>();
      const lines = input.items.map((item) => {
        const product = byId.get(item.productId)!;
        if (!product.isActive) {
          throw new BadRequestError(`Product "${product.name}" is retired and cannot be sold.`);
        }
        stockDelta.set(product.id, (stockDelta.get(product.id) ?? 0) + item.quantity);
        return {
          productId: product.id,
          nameSnapshot: product.name,
          unitPriceMinor: product.priceMinor,
          quantity: item.quantity,
          lineTotalMinor: product.priceMinor * item.quantity,
        };
      });
      const totalMinor = lines.reduce((a, l) => a + l.lineTotalMinor, 0);

      // Apply stock decrements, refusing to oversell a tracked product.
      for (const [productId, qty] of stockDelta) {
        const product = byId.get(productId)!;
        if (product.trackStock) {
          if (product.stockQty < qty) {
            throw new ConflictError(`Insufficient stock for "${product.name}" (${product.stockQty} left).`);
          }
          await tx.posProduct.update({ where: { id: productId }, data: { stockQty: { decrement: qty } } });
        }
      }

      // Settlement.
      let status: 'OPEN' | 'CHARGED' | 'PAID' = 'OPEN';
      let settlement: 'UNSETTLED' | 'ROOM_CHARGE' | 'DIRECT' = 'UNSETTLED';
      let reservationId: string | null = null;
      let folioChargeId: string | null = null;
      let paymentMethod: string | null = null;
      let settledAt: Date | null = null;

      if (input.settlement === 'ROOM_CHARGE') {
        const reservation = await posRepository.findReservationForCharge(propertyId, input.reservationId!, txDb);
        if (!reservation) throw new NotFoundError('Reservation not found.');
        if (reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') {
          throw new BadRequestError('Cannot charge a cancelled or no-show reservation.');
        }
        // Open (or find) the folio, then post one charge for the order total.
        const folio = await tx.folio.upsert({
          where: { reservationId: reservation.id },
          create: { reservationId: reservation.id },
          update: {},
        });
        const charge = await tx.folioCharge.create({
          data: {
            folioId: folio.id,
            description: `POS — ${outlet.name}`,
            amountMinor: totalMinor,
          },
        });
        status = 'CHARGED';
        settlement = 'ROOM_CHARGE';
        reservationId = reservation.id;
        folioChargeId = charge.id;
        settledAt = new Date();
      } else if (input.settlement === 'DIRECT') {
        status = 'PAID';
        settlement = 'DIRECT';
        paymentMethod = input.paymentMethod!;
        settledAt = new Date();
      }

      // Unique reference within the property, retried on the rare clash.
      let reference = generateReference();
      for (let i = 0; i < 5; i += 1) {
        const clash = await posRepository.countOrderReference(propertyId, reference, txDb);
        if (!clash) break;
        reference = generateReference();
      }

      const created = await tx.posOrder.create({
        data: {
          propertyId,
          outletId: input.outletId,
          reference,
          status,
          settlement,
          reservationId,
          folioChargeId,
          paymentMethod: paymentMethod as never,
          totalMinor,
          notes: input.notes ?? null,
          settledAt,
          items: { create: lines },
        },
        include: posRepository.include,
      });

      const action =
        status === 'CHARGED'
          ? AUDIT_ACTIONS.POS_ORDER_CHARGED
          : status === 'PAID'
            ? AUDIT_ACTIONS.POS_ORDER_PAID
            : AUDIT_ACTIONS.POS_ORDER_CREATED;
      await recordAuditEvent(
        {
          action,
          entityType: AUDIT_ENTITY_TYPES.POS_ORDER,
          entityId: created.id,
          metadata: {
            reference: created.reference,
            outletId: input.outletId,
            totalMinor,
            settlement,
            ...(reservationId ? { reservationId } : {}),
            ...(folioChargeId ? { folioChargeId } : {}),
          },
        },
        tx,
      );

      return orderView(created);
    },
    { isolationLevel: 'Serializable' },
  );
}

/**
 * Voids an order. Only an OPEN order can be voided — a settled order has
 * already moved money (a folio charge or a taken payment) and must be reversed
 * through the folio, not silently un-billed here. Voiding restocks any tracked
 * products the order decremented.
 */
export async function voidOrder(propertyId: string, orderId: string) {
  await assertPropertyVisible(propertyId);

  return scopedPrisma.$transaction(async (tx) => {
    const txDb = tx as unknown as PosDb;
    const order = await posRepository.findOrder(propertyId, orderId, txDb);
    if (!order) throw new NotFoundError('Order not found.');
    if (order.status !== 'OPEN') {
      throw new ConflictError('Only an open order can be voided; settle or reverse a charged/paid order via its folio.');
    }

    // Restock tracked products.
    for (const line of order.items) {
      const product = await posRepository.findProduct(order.outletId, line.productId, txDb);
      if (product?.trackStock) {
        await tx.posProduct.update({ where: { id: product.id }, data: { stockQty: { increment: line.quantity } } });
      }
    }

    const updated = await tx.posOrder.update({
      where: { id: orderId },
      data: { status: 'VOID' },
      include: posRepository.include,
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.POS_ORDER_VOIDED,
        entityType: AUDIT_ENTITY_TYPES.POS_ORDER,
        entityId: orderId,
        metadata: { reference: order.reference, totalMinor: order.totalMinor },
      },
      tx,
    );
    return orderView(updated);
  });
}

/** A JSON-safe scalar an audit diff can record. */
type DiffScalar = string | number | boolean | null;

/** A generic before/after diff over a known set of fields, for audit metadata. */
function buildDiff(
  existing: Record<string, unknown>,
  input: Record<string, unknown>,
  fields: string[],
): { from: Record<string, DiffScalar>; to: Record<string, DiffScalar> } {
  const from: Record<string, DiffScalar> = {};
  const to: Record<string, DiffScalar> = {};
  for (const field of fields) {
    if (!(field in input)) continue;
    const next = input[field];
    if (next === undefined) continue;
    if (existing[field] !== next) {
      from[field] = existing[field] as DiffScalar;
      to[field] = next as DiffScalar;
    }
  }
  return { from, to };
}

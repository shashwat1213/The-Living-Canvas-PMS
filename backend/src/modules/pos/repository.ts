import type { Prisma } from '@prisma/client';

import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type {
  ListOrdersQuery,
  ListOutletsQuery,
  ListProductsQuery,
} from './schemas.js';

/** A Prisma client or an interactive-transaction client — repository helpers accept either. */
export type PosDb = typeof scopedPrisma | Prisma.TransactionClient;

const db = (client?: PosDb) => client ?? scopedPrisma;

// ---------- Outlets ----------

function outletWhere(propertyId: string, query: ListOutletsQuery): Prisma.PosOutletWhereInput {
  const conditions: Prisma.PosOutletWhereInput[] = [{ propertyId }];
  if (query.status) {
    conditions.push({ isActive: query.status === 'ACTIVE' });
  }
  if (query.search) {
    conditions.push({ name: { contains: query.search, mode: 'insensitive' } });
  }
  return { AND: conditions };
}

// ---------- Products ----------

function productWhere(outletId: string, query: ListProductsQuery): Prisma.PosProductWhereInput {
  const conditions: Prisma.PosProductWhereInput[] = [{ outletId }];
  if (query.status) {
    conditions.push({ isActive: query.status === 'ACTIVE' });
  }
  if (query.search) {
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          { category: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }
  return { AND: conditions };
}

// ---------- Orders ----------

const orderInclude = {
  outlet: { select: { id: true, name: true, type: true } },
  reservation: { select: { id: true, reference: true } },
  items: {
    select: { id: true, productId: true, nameSnapshot: true, unitPriceMinor: true, quantity: true, lineTotalMinor: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PosOrderInclude;

export type PosOrderRow = Prisma.PosOrderGetPayload<{ include: typeof orderInclude }>;

function orderWhere(propertyId: string, query: ListOrdersQuery): Prisma.PosOrderWhereInput {
  const conditions: Prisma.PosOrderWhereInput[] = [{ propertyId }];
  if (query.status) conditions.push({ status: query.status });
  if (query.outletId) conditions.push({ outletId: query.outletId });
  if (query.search) {
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { reference: { contains: term, mode: 'insensitive' } },
          { outlet: { name: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
  }
  return { AND: conditions };
}

export const posRepository = {
  // ----- Property visibility (shared 404 gate) -----
  async findProperty(propertyId: string) {
    return scopedPrisma.property.findFirst({ where: { id: propertyId }, select: { id: true } });
  },

  // ----- Outlets -----
  async listOutlets(propertyId: string, query: ListOutletsQuery): Promise<{ items: unknown[]; page: PageMeta }> {
    const where = outletWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);
    const [items, totalItems] = await scopedPrisma.$transaction([
      scopedPrisma.posOutlet.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take }),
      scopedPrisma.posOutlet.count({ where }),
    ]);
    return { items, page: buildPageMeta(query, totalItems) };
  },

  findOutlet(propertyId: string, outletId: string, client?: PosDb) {
    return db(client).posOutlet.findFirst({ where: { id: outletId, propertyId } });
  },

  findOutletByName(propertyId: string, name: string) {
    return scopedPrisma.posOutlet.findFirst({ where: { propertyId, name: { equals: name, mode: 'insensitive' } } });
  },

  createOutlet(data: Prisma.PosOutletUncheckedCreateInput) {
    return scopedPrisma.posOutlet.create({ data });
  },

  updateOutlet(outletId: string, data: Prisma.PosOutletUpdateInput) {
    return scopedPrisma.posOutlet.update({ where: { id: outletId }, data });
  },

  // ----- Products -----
  async listProducts(outletId: string, query: ListProductsQuery): Promise<{ items: unknown[]; page: PageMeta }> {
    const where = productWhere(outletId, query);
    const { skip, take } = toSkipTake(query);
    const [items, totalItems] = await scopedPrisma.$transaction([
      scopedPrisma.posProduct.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take }),
      scopedPrisma.posProduct.count({ where }),
    ]);
    return { items, page: buildPageMeta(query, totalItems) };
  },

  findProduct(outletId: string, productId: string, client?: PosDb) {
    return db(client).posProduct.findFirst({ where: { id: productId, outletId } });
  },

  createProduct(data: Prisma.PosProductUncheckedCreateInput) {
    return scopedPrisma.posProduct.create({ data });
  },

  updateProduct(productId: string, data: Prisma.PosProductUpdateInput) {
    return scopedPrisma.posProduct.update({ where: { id: productId }, data });
  },

  /** Products of an outlet by id, for order pricing — read inside the order transaction. */
  findProductsByIds(outletId: string, ids: string[], client: PosDb) {
    return client.posProduct.findMany({ where: { outletId, id: { in: ids } } });
  },

  // ----- Orders -----
  async listOrders(propertyId: string, query: ListOrdersQuery): Promise<{ items: PosOrderRow[]; page: PageMeta }> {
    const where = orderWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);
    const [items, totalItems] = await scopedPrisma.$transaction([
      scopedPrisma.posOrder.findMany({ where, include: orderInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      scopedPrisma.posOrder.count({ where }),
    ]);
    return { items, page: buildPageMeta(query, totalItems) };
  },

  findOrder(propertyId: string, orderId: string, client?: PosDb): Promise<PosOrderRow | null> {
    return db(client).posOrder.findFirst({ where: { id: orderId, propertyId }, include: orderInclude });
  },

  findReservationForCharge(propertyId: string, reservationId: string, client: PosDb) {
    return client.reservation.findFirst({
      where: { id: reservationId, propertyId },
      select: { id: true, reference: true, status: true },
    });
  },

  countOrderReference(propertyId: string, reference: string, client: PosDb) {
    return client.posOrder.findFirst({ where: { propertyId, reference }, select: { id: true } });
  },

  include: orderInclude,
};

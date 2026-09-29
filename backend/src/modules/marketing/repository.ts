import type { Prisma } from '@prisma/client';

import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { ListContentQuery } from './schemas.js';

/** The columns a piece of content is served with, plus the acting users. */
const contentSelect = {
  id: true,
  propertyId: true,
  format: true,
  status: true,
  tone: true,
  brief: true,
  title: true,
  generatedBody: true,
  editedBody: true,
  provider: true,
  lastError: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.MarketingContentSelect;

export type MarketingContentRow = Prisma.MarketingContentGetPayload<{ select: typeof contentSelect }>;

/** The client surface the service passes into a transaction. Structural so
 * base/scoped clients and their transactions all satisfy it. */
export type MarketingDb = Prisma.TransactionClient;

/** No `propertyId`/`organizationId` filter is written here beyond the
 * explicit property scope — the tenancy extension ANDs the org in. */
function buildWhere(propertyId: string, query: ListContentQuery): Prisma.MarketingContentWhereInput {
  const where: Prisma.MarketingContentWhereInput = { propertyId };
  if (query.format) where.format = query.format;
  if (query.status) where.status = query.status;
  if (query.search) {
    const terms = query.search.split(/\s+/).filter(Boolean);
    where.AND = terms.map((term) => ({
      OR: [
        { brief: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
        { generatedBody: { contains: term, mode: 'insensitive' } },
        { editedBody: { contains: term, mode: 'insensitive' } },
      ],
    }));
  }
  return where;
}

export const marketingRepository = {
  async list(
    propertyId: string,
    query: ListContentQuery,
  ): Promise<{ items: MarketingContentRow[]; page: PageMeta }> {
    const where = buildWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, rows] = await scopedPrisma.$transaction([
      scopedPrisma.marketingContent.count({ where }),
      scopedPrisma.marketingContent.findMany({
        where,
        select: contentSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    return { items: rows, page: buildPageMeta(query, totalItems) };
  },

  async findById(propertyId: string, id: string): Promise<MarketingContentRow | null> {
    return scopedPrisma.marketingContent.findFirst({
      where: { id, propertyId },
      select: contentSelect,
    });
  },
};

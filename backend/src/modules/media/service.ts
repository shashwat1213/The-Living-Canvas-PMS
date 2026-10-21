import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { BadRequestError, NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { getStorageProvider } from '../../platform/storage/registry.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateUploadInput, ListAssetsQuery, UpdateAssetInput } from './schemas.js';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const VIEW_URL_TTL_SECONDS = 60 * 60;

const assetSelect = {
  id: true,
  propertyId: true,
  kind: true,
  status: true,
  storageKey: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  title: true,
  description: true,
  album: true,
  tags: true,
  width: true,
  height: true,
  durationMs: true,
  sourceAssetId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.MediaAssetSelect;

type AssetRow = Prisma.MediaAssetGetPayload<{ select: typeof assetSelect }>;

/** Wire shape. `storageKey` is never exposed; `url` is a short-lived signed link. */
export interface MediaAssetView {
  id: string;
  propertyId: string;
  kind: AssetRow['kind'];
  status: AssetRow['status'];
  fileName: string;
  contentType: string;
  sizeBytes: number;
  title: string | null;
  description: string | null;
  album: string | null;
  tags: string[];
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sourceAssetId: string | null;
  url: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
}

async function serialize(row: AssetRow): Promise<MediaAssetView> {
  const url =
    row.status === 'READY'
      ? await getStorageProvider().createDownloadUrl({ storageKey: row.storageKey, expiresInSeconds: VIEW_URL_TTL_SECONDS })
      : null;
  return {
    id: row.id,
    propertyId: row.propertyId,
    kind: row.kind,
    status: row.status,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    title: row.title,
    description: row.description,
    album: row.album,
    tags: row.tags,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sourceAssetId: row.sourceAssetId,
    url,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertProperty(propertyId: string): Promise<{ organizationId: string }> {
  const property = await scopedPrisma.property.findFirst({
    where: { id: propertyId },
    select: { id: true, organizationId: true },
  });
  if (!property) throw new NotFoundError('Property not found.');
  return property;
}

async function findAsset(propertyId: string, id: string): Promise<AssetRow> {
  const row = await scopedPrisma.mediaAsset.findFirst({ where: { id, propertyId }, select: assetSelect });
  if (!row) throw new NotFoundError('Media not found.');
  return row;
}

function extensionFor(fileName: string, contentType: string): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return contentType.split('/')[1]?.replace('quicktime', 'mov') ?? 'bin';
}

export async function listAssets(
  propertyId: string,
  query: ListAssetsQuery,
): Promise<{ items: MediaAssetView[]; page: PageMeta }> {
  await assertProperty(propertyId);
  const where: Prisma.MediaAssetWhereInput = { propertyId, status: 'READY' };
  if (query.kind) where.kind = query.kind;
  if (query.album) where.album = query.album;
  if (query.search) {
    const terms = query.search.split(/\s+/).filter(Boolean);
    where.AND = terms.map((term) => ({
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { fileName: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { album: { contains: term, mode: 'insensitive' } },
        { tags: { has: term.toLowerCase() } },
      ],
    }));
  }
  const { skip, take } = toSkipTake(query);
  const [totalItems, rows] = await scopedPrisma.$transaction([
    scopedPrisma.mediaAsset.count({ where }),
    scopedPrisma.mediaAsset.findMany({
      where,
      select: assetSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
  ]);
  return { items: await Promise.all(rows.map(serialize)), page: buildPageMeta(query, totalItems) };
}

/** Albums (events) with their READY item counts, for the library sidebar. */
export async function listAlbums(propertyId: string): Promise<{ album: string; count: number }[]> {
  await assertProperty(propertyId);
  const groups = await scopedPrisma.mediaAsset.groupBy({
    by: ['album'],
    where: { propertyId, status: 'READY', album: { not: null } },
    _count: { _all: true },
    orderBy: { album: 'asc' },
  });
  return groups.map((g) => ({ album: g.album as string, count: g._count._all }));
}

export async function getAsset(propertyId: string, id: string): Promise<MediaAssetView> {
  return serialize(await findAsset(propertyId, id));
}

/**
 * Step 1 of an upload: create the PENDING catalogue row with a
 * server-generated storage key and hand back a presigned PUT URL. The key is
 * namespaced by organization and property so objects can never collide or be
 * addressed across tenants.
 */
export async function createUpload(
  propertyId: string,
  input: CreateUploadInput,
): Promise<{ asset: MediaAssetView; uploadUrl: string; uploadHeaders: Record<string, string> }> {
  const property = await assertProperty(propertyId);
  const ctx = getRequestContext();
  // The in-memory stub is for tests/dev only; in production it would hand
  // out URLs nothing can upload to. Refuse clearly instead.
  if (getStorageProvider().key === 'stub' && process.env.NODE_ENV === 'production') {
    throw new BadRequestError('Media storage is not configured yet. Ask an administrator to connect S3.');
  }
  const kind = input.contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE';
  const storageKey = `orgs/${property.organizationId}/properties/${propertyId}/media/${randomUUID()}.${extensionFor(
    input.fileName,
    input.contentType,
  )}`;

  const row = await scopedPrisma.mediaAsset.create({
    data: {
      propertyId,
      kind,
      status: 'PENDING',
      storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      title: input.title ?? null,
      description: input.description ?? null,
      album: input.album ?? null,
      tags: (input.tags ?? []).map((t) => t.toLowerCase()),
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: input.durationMs ?? null,
      createdByUserId: ctx.userId,
    },
    select: assetSelect,
  });

  const uploadUrl = await getStorageProvider().createUploadUrl({
    storageKey,
    contentType: input.contentType,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  return { asset: await serialize(row), uploadUrl, uploadHeaders: { 'Content-Type': input.contentType } };
}

/**
 * Step 2: the browser finished its PUT. Verify the object really exists in
 * storage with the declared size and type before it becomes visible — a
 * client cannot mark something READY that was never uploaded, nor swap in a
 * different (e.g. oversized or non-media) file.
 */
export async function completeUpload(propertyId: string, id: string): Promise<MediaAssetView> {
  const row = await findAsset(propertyId, id);
  if (row.status === 'READY') return serialize(row);

  const storage = getStorageProvider();
  const info = await storage.headObject(row.storageKey);
  if (!info) throw new BadRequestError('The file has not been uploaded yet.');
  if (info.sizeBytes !== row.sizeBytes || (info.contentType && info.contentType !== row.contentType)) {
    await storage.deleteObject(row.storageKey).catch(() => undefined);
    await scopedPrisma.mediaAsset.delete({ where: { id: row.id } });
    throw new BadRequestError('The uploaded file did not match what was declared. Please upload it again.');
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.mediaAsset.update({ where: { id: row.id }, data: { status: 'READY' } });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MEDIA_ASSET_UPLOADED,
        entityType: AUDIT_ENTITY_TYPES.MEDIA_ASSET,
        entityId: row.id,
        metadata: { propertyId, kind: row.kind, fileName: row.fileName, sizeBytes: row.sizeBytes, ...(row.album ? { album: row.album } : {}) },
      },
      tx,
    );
  });
  return getAsset(propertyId, id);
}

export async function updateAsset(propertyId: string, id: string, input: UpdateAssetInput): Promise<MediaAssetView> {
  const row = await findAsset(propertyId, id);
  const data: Prisma.MediaAssetUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.album !== undefined) data.album = input.album;
  if (input.tags !== undefined) data.tags = input.tags.map((t) => t.toLowerCase());

  await scopedPrisma.$transaction(async (tx) => {
    await tx.mediaAsset.update({ where: { id: row.id }, data });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MEDIA_ASSET_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.MEDIA_ASSET,
        entityId: row.id,
        metadata: { propertyId, fields: Object.keys(input) },
      },
      tx,
    );
  });
  return getAsset(propertyId, id);
}

/** Removes the catalogue row (audited) and then the stored object. */
export async function deleteAsset(propertyId: string, id: string): Promise<void> {
  const row = await findAsset(propertyId, id);
  await scopedPrisma.$transaction(async (tx) => {
    await tx.mediaAsset.delete({ where: { id: row.id } });
    if (row.status === 'READY') {
      await recordAuditEvent(
        {
          action: AUDIT_ACTIONS.MEDIA_ASSET_DELETED,
          entityType: AUDIT_ENTITY_TYPES.MEDIA_ASSET,
          entityId: row.id,
          metadata: { propertyId, kind: row.kind, fileName: row.fileName, ...(row.album ? { album: row.album } : {}) },
        },
        tx,
      );
    }
  });
  await getStorageProvider()
    .deleteObject(row.storageKey)
    .catch((error: unknown) => console.error('[media] failed to delete stored object', row.storageKey, error));
}

/** A signed URL that downloads the original with its file name. */
export async function getDownloadUrl(propertyId: string, id: string): Promise<string> {
  const row = await findAsset(propertyId, id);
  if (row.status !== 'READY') throw new NotFoundError('Media not found.');
  return getStorageProvider().createDownloadUrl({
    storageKey: row.storageKey,
    expiresInSeconds: 5 * 60,
    downloadName: row.fileName,
  });
}

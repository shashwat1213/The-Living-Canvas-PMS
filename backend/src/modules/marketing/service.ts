import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import type { PageMeta } from '../../lib/pagination.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../platform/audit/actions.js';
import { recordAuditEvent } from '../../platform/audit/recorder.js';
import { enqueueJob } from '../../platform/jobs/queue.js';
import { MARKETING_GENERATE_JOB } from '../../platform/ai/generate-handler.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { marketingRepository, type MarketingContentRow } from './repository.js';
import type { CreateContentInput, ListContentQuery, UpdateContentInput } from './schemas.js';

/**
 * The wire shape of a piece of marketing content. `body` is derived — the
 * staff edit wins over the generated text — so the client always renders the
 * authoritative copy without having to know the precedence rule. Dates are
 * ISO strings.
 */
export interface MarketingContentView {
  id: string;
  propertyId: string;
  format: MarketingContentRow['format'];
  status: MarketingContentRow['status'];
  tone: string | null;
  brief: string;
  title: string | null;
  /** The generated text, exactly as the provider produced it. */
  generatedBody: string | null;
  /** The staff-edited text, if any. */
  editedBody: string | null;
  /** The authoritative body to display: edited if present, else generated. */
  body: string | null;
  /** True when staff have edited the generated copy. */
  isEdited: boolean;
  provider: string | null;
  lastError: string | null;
  createdBy: { id: string; firstName: string; lastName: string; email: string } | null;
  approvedBy: { id: string; firstName: string; lastName: string; email: string } | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: MarketingContentRow): MarketingContentView {
  const body = row.editedBody ?? row.generatedBody;
  return {
    id: row.id,
    propertyId: row.propertyId,
    format: row.format,
    status: row.status,
    tone: row.tone,
    brief: row.brief,
    title: row.title,
    generatedBody: row.generatedBody,
    editedBody: row.editedBody,
    body,
    isEdited: row.editedBody !== null,
    provider: row.provider,
    lastError: row.lastError,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Confirms the property is in the caller's organization (via the scoped
 * client). A cross-org/cross-property id resolves to nothing → 404. */
async function assertProperty(propertyId: string): Promise<void> {
  const property = await scopedPrisma.property.findFirst({
    where: { id: propertyId },
    select: { id: true },
  });
  if (!property) {
    throw new NotFoundError('Property not found.');
  }
}

export async function listContent(
  propertyId: string,
  query: ListContentQuery,
): Promise<{ items: MarketingContentView[]; page: PageMeta }> {
  await assertProperty(propertyId);
  const { items, page } = await marketingRepository.list(propertyId, query);
  return { items: items.map(serialize), page };
}

export async function getContent(propertyId: string, id: string): Promise<MarketingContentView> {
  const row = await marketingRepository.findById(propertyId, id);
  if (!row) {
    throw new NotFoundError('Marketing content not found.');
  }
  return serialize(row);
}

/**
 * Requests a new piece of copy. The row is created GENERATING and a
 * `marketing.generate` job is enqueued in the same transaction, so the row
 * and its generation job commit together — no row without a job, no job for
 * a row that didn't persist (the same rule notifications follow). The worker
 * fills the body and moves it to DRAFT. Actor comes from the request
 * context, never a parameter.
 */
export async function createContent(
  propertyId: string,
  input: CreateContentInput,
): Promise<MarketingContentView> {
  await assertProperty(propertyId);
  const ctx = getRequestContext();

  const created = await scopedPrisma.$transaction(async (tx) => {
    const content = await tx.marketingContent.create({
      data: {
        propertyId,
        format: input.format,
        status: 'GENERATING',
        brief: input.brief,
        tone: input.tone ?? null,
        createdByUserId: ctx.userId,
      },
    });

    await enqueueJob({ type: MARKETING_GENERATE_JOB, payload: { contentId: content.id } }, tx);

    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MARKETING_CONTENT_REQUESTED,
        entityType: AUDIT_ENTITY_TYPES.MARKETING_CONTENT,
        entityId: content.id,
        metadata: { format: input.format, ...(input.tone ? { tone: input.tone } : {}) },
      },
      tx,
    );

    return content;
  });

  return getContent(propertyId, created.id);
}

/**
 * Edits a draft's title/body. Only a DRAFT or APPROVED piece is editable —
 * editing sets `editedBody`, which the view treats as authoritative. A
 * GENERATING piece has no body yet; a DISCARDED/FAILED one is not editable.
 * Editing an APPROVED piece returns it to DRAFT: the approved version was
 * signed off, and changed copy must be re-approved before it counts as
 * approved again.
 */
export async function updateContent(
  propertyId: string,
  id: string,
  input: UpdateContentInput,
): Promise<MarketingContentView> {
  const before = await getContent(propertyId, id);
  if (before.status !== 'DRAFT' && before.status !== 'APPROVED') {
    throw new ConflictError(
      `A ${before.status.toLowerCase()} piece cannot be edited.`,
    );
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.marketingContent.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.editedBody !== undefined ? { editedBody: input.editedBody } : {}),
        // Editing an approved piece un-approves it — the change must be
        // signed off again.
        ...(before.status === 'APPROVED'
          ? { status: 'DRAFT', approvedByUserId: null, approvedAt: null }
          : {}),
      },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MARKETING_CONTENT_EDITED,
        entityType: AUDIT_ENTITY_TYPES.MARKETING_CONTENT,
        entityId: id,
        metadata: { ...(before.status === 'APPROVED' ? { unapproved: true } : {}) },
      },
      tx,
    );
  });

  return getContent(propertyId, id);
}

/** Approves a DRAFT for use. Only a DRAFT can be approved (a GENERATING
 * piece has no body; a FAILED/DISCARDED one is not publishable; re-approving
 * an APPROVED piece is a no-op conflict). Records who approved and when. */
export async function approveContent(propertyId: string, id: string): Promise<MarketingContentView> {
  const before = await getContent(propertyId, id);
  if (before.status !== 'DRAFT') {
    throw new ConflictError(`Only a draft can be approved (this one is ${before.status.toLowerCase()}).`);
  }
  const ctx = getRequestContext();

  await scopedPrisma.$transaction(async (tx) => {
    await tx.marketingContent.update({
      where: { id },
      data: { status: 'APPROVED', approvedByUserId: ctx.userId, approvedAt: new Date() },
    });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MARKETING_CONTENT_APPROVED,
        entityType: AUDIT_ENTITY_TYPES.MARKETING_CONTENT,
        entityId: id,
      },
      tx,
    );
  });

  return getContent(propertyId, id);
}

/** Discards a piece (any non-discarded status). Kept for the record, not
 * used. Idempotent-ish: discarding a discarded piece is a no-op conflict. */
export async function discardContent(propertyId: string, id: string): Promise<MarketingContentView> {
  const before = await getContent(propertyId, id);
  if (before.status === 'DISCARDED') {
    throw new ConflictError('This piece is already discarded.');
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.marketingContent.update({ where: { id }, data: { status: 'DISCARDED' } });
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MARKETING_CONTENT_DISCARDED,
        entityType: AUDIT_ENTITY_TYPES.MARKETING_CONTENT,
        entityId: id,
        metadata: { from: before.status },
      },
      tx,
    );
  });

  return getContent(propertyId, id);
}

/**
 * Regenerates a piece: clears the previous output, returns it to GENERATING
 * and enqueues a fresh generation job. Any staff edit is discarded — a
 * regenerate is an explicit "try again from the brief". Not allowed while
 * already GENERATING (a job is in flight). The brief/format/tone are reused.
 */
export async function regenerateContent(propertyId: string, id: string): Promise<MarketingContentView> {
  const before = await getContent(propertyId, id);
  if (before.status === 'GENERATING') {
    throw new ConflictError('This piece is already generating.');
  }

  await scopedPrisma.$transaction(async (tx) => {
    await tx.marketingContent.update({
      where: { id },
      data: {
        status: 'GENERATING',
        generatedBody: null,
        editedBody: null,
        title: null,
        provider: null,
        lastError: null,
        approvedByUserId: null,
        approvedAt: null,
      },
    });
    await enqueueJob({ type: MARKETING_GENERATE_JOB, payload: { contentId: id } }, tx);
    await recordAuditEvent(
      {
        action: AUDIT_ACTIONS.MARKETING_CONTENT_REGENERATED,
        entityType: AUDIT_ENTITY_TYPES.MARKETING_CONTENT,
        entityId: id,
        metadata: { from: before.status },
      },
      tx,
    );
  });

  return getContent(propertyId, id);
}

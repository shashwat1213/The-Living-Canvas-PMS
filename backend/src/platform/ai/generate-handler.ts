import type { Prisma } from '@prisma/client';

import { registerJobHandler } from '../jobs/registry.js';
import { scopedPrisma } from '../tenancy/scoped-prisma.js';
import { getContentProvider } from './registry.js';
import type { MarketingFormat } from './provider.js';

/** The job type the content-generation handler processes. */
export const MARKETING_GENERATE_JOB = 'marketing.generate';

/**
 * Handles a `marketing.generate` job: load the GENERATING content row,
 * generate copy through the active provider, and move it to DRAFT (or
 * FAILED on error). Runs inside the job's organization context (the worker
 * sets it), so `scopedPrisma` finds only this tenant's row — a payload
 * naming another org's content resolves to nothing and is treated as a
 * spent job, never a cross-tenant read.
 *
 * Idempotent: a row no longer GENERATING (already drafted, edited, approved,
 * discarded) is left untouched, so a job that runs twice — a process dying
 * after the write but before the row is marked COMPLETED — never overwrites
 * reviewed copy.
 *
 * A provider that throws propagates after the row is marked FAILED with the
 * error, so the job worker's retry/backoff takes over; a later successful
 * attempt flips the row back to DRAFT. The job itself carries the retry
 * budget — the handler just records the latest outcome on the row.
 */
export async function handleMarketingGenerate(payload: Prisma.JsonValue): Promise<void> {
  const contentId =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).contentId
      : undefined;
  if (typeof contentId !== 'string') {
    throw new Error('marketing.generate job payload is missing a string contentId.');
  }

  const content = await scopedPrisma.marketingContent.findFirst({
    where: { id: contentId },
    include: { property: { select: { name: true, city: true, country: true } } },
  });
  if (!content) {
    // Row gone or another tenant's — nothing to generate. Let the job
    // complete rather than retry forever.
    return;
  }
  if (content.status !== 'GENERATING') {
    return;
  }

  const provider = getContentProvider();
  try {
    const result = await provider.generate({
      format: content.format as MarketingFormat,
      brief: content.brief,
      tone: content.tone ?? undefined,
      property: {
        name: content.property.name,
        city: content.property.city,
        country: content.property.country,
      },
    });

    await scopedPrisma.marketingContent.update({
      where: { id: content.id },
      data: {
        status: 'DRAFT',
        title: result.title,
        generatedBody: result.body,
        provider: provider.key,
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await scopedPrisma.marketingContent.update({
      where: { id: content.id },
      data: { status: 'FAILED', lastError: message },
    });
    // Re-throw so the job's own retry/backoff runs; a later successful
    // attempt flips the row back to DRAFT.
    throw error;
  }
}

let registered = false;

/** Registers the marketing generation handler. Called once at startup
 * (app construction) and guarded against duplicate registration. */
export function registerMarketingHandlers(): void {
  if (registered) return;
  registerJobHandler(MARKETING_GENERATE_JOB, handleMarketingGenerate);
  registered = true;
}

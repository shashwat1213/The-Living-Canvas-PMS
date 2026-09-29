/**
 * The AI content-generation seam the Marketing Studio is built around.
 *
 * This is the one interface the studio (and any future AI-authoring feature)
 * depends on — the module, the queue job and the UI never name a vendor. A
 * real LLM adapter (OpenAI, Anthropic, a self-hosted model) is a drop-in
 * implementation registered against a provider key; until credentials exist,
 * the deterministic `stub` driver stands in, so the whole generate → review →
 * approve pipeline runs end-to-end in dev, tests and CI with no account and
 * no cost. This mirrors the notification channel-driver pattern and matches
 * the `AIMediaProvider` direction locked in ARCHITECTURE.md — copy first,
 * image/video adapters behind the same shape later.
 */

/** The kinds of marketing copy the studio can generate. Mirrors the
 * `MarketingContentFormat` enum. */
export type MarketingFormat = 'SOCIAL_POST' | 'EMAIL' | 'PROMO_DESCRIPTION' | 'TAGLINE';

/** Everything a provider needs to compose one piece — the staff brief plus
 * the property context that grounds it, so generated copy is about this
 * hotel, not generic filler. */
export interface ContentGenerationRequest {
  format: MarketingFormat;
  brief: string;
  tone?: string;
  property: {
    name: string;
    city?: string | null;
    country?: string | null;
  };
}

/** The composed result: an optional title/subject and the body. A provider
 * that fails should throw — the job worker records the error and retries with
 * backoff, exactly as it does for notification delivery. */
export interface GeneratedContent {
  title: string | null;
  body: string;
}

export interface AIContentProvider {
  /** A stable key stored on the row for the record (e.g. "stub",
   * "openai:gpt-4o"), so an old piece shows what produced it even after the
   * default provider changes. */
  readonly key: string;
  generate(request: ContentGenerationRequest): Promise<GeneratedContent>;
}

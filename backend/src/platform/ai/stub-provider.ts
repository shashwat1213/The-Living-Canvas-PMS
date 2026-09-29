import type { AIContentProvider, ContentGenerationRequest, GeneratedContent } from './provider.js';

/**
 * Deterministic, offline content provider — the default until a real LLM
 * adapter is configured.
 *
 * It composes plausible, property-grounded copy per format from the brief
 * and property context, with no external call, no credentials and no cost.
 * Deterministic on purpose: the same request always yields the same output,
 * so tests assert exact strings and the whole pipeline (queue → generate →
 * review → approve) is exercised end-to-end. When a real adapter lands it
 * registers under its own key and this becomes the fallback for anyone who
 * hasn't configured one.
 */

function place(req: ContentGenerationRequest): string {
  const { city, country } = req.property;
  if (city && country) return `${city}, ${country}`;
  return city ?? country ?? '';
}

function toneLead(tone?: string): string {
  return tone ? `${tone.charAt(0).toUpperCase()}${tone.slice(1)} vibes — ` : '';
}

export const stubContentProvider: AIContentProvider = {
  key: 'stub',
  async generate(req: ContentGenerationRequest): Promise<GeneratedContent> {
    const { name } = req.property;
    const where = place(req);
    const wherePhrase = where ? ` in ${where}` : '';
    const brief = req.brief.trim();

    switch (req.format) {
      case 'TAGLINE':
        return {
          title: `${name} — tagline`,
          body: `${name}${wherePhrase}: where ${brief.toLowerCase().replace(/\.$/, '')} feels like home.`,
        };
      case 'SOCIAL_POST': {
        const cityTag = where ? where.split(',')[0]?.replace(/\s+/g, '') ?? '' : '';
        return {
          title: `${name} social post`,
          body:
            `${toneLead(req.tone)}✨ ${brief}\n\n` +
            `Come experience ${name}${wherePhrase}. Book direct for our best rates.\n\n` +
            `#${name.replace(/\s+/g, '')} #Travel${cityTag ? ` #${cityTag}` : ''}`,
        };
      }
      case 'EMAIL':
        return {
          title: `A special invitation from ${name}`,
          body:
            `Dear Guest,\n\n` +
            `${brief}\n\n` +
            `We would love to welcome you to ${name}${wherePhrase}. ` +
            `${toneLead(req.tone)}reserve your stay today and enjoy our best available rate when you book direct.\n\n` +
            `Warm regards,\nThe team at ${name}`,
        };
      case 'PROMO_DESCRIPTION':
        return {
          title: `${name} — promotional description`,
          body:
            `${brief}\n\n` +
            `Nestled${wherePhrase ? ` ${wherePhrase.trim()}` : ''}, ${name} offers a stay to remember. ` +
            `${toneLead(req.tone)}discover thoughtful comfort, genuine hospitality, and a location you'll love.`,
        };
      default: {
        // Exhaustiveness guard — a new format must add a branch above.
        const _never: never = req.format;
        throw new Error(`Unhandled marketing format: ${String(_never)}`);
      }
    }
  },
};

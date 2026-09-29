import { useState } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { createContent } from './api';
import { FORMAT_LABEL, MARKETING_FORMATS, type MarketingContent, type MarketingFormat } from './types';

/**
 * The "generate content" form: pick a format, describe what to write (the
 * brief), optionally set a tone. Submitting queues an async generation job
 * and returns the new GENERATING row; the page then polls it to DRAFT.
 */
export function GenerateDialog({
  propertyId,
  onClose,
  onGenerated,
}: {
  propertyId: string;
  onClose: () => void;
  onGenerated: (content: MarketingContent) => void;
}) {
  const [format, setFormat] = useState<MarketingFormat>('SOCIAL_POST');
  const [brief, setBrief] = useState('');
  const [tone, setTone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = brief.trim().length >= 3 && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { content } = await createContent(propertyId, {
        format,
        brief: brief.trim(),
        tone: tone.trim() || undefined,
      });
      onGenerated(content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start generation.');
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Generate marketing content"
      description="Describe what you want and the studio will draft it for review."
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="generate-form" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? 'Generating…' : 'Generate'}
          </button>
        </>
      }
    >
      <form id="generate-form" className="marketing-form" onSubmit={(e) => void handleSubmit(e)}>
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as MarketingFormat)}>
            {MARKETING_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Brief
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder="e.g. A weekend monsoon getaway offer — 20% off, free breakfast, valid through August."
            required
          />
        </label>
        <label>
          Tone <span className="marketing-optional">(optional)</span>
          <input
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="e.g. luxury, playful, warm"
            maxLength={60}
          />
        </label>
      </form>
    </Modal>
  );
}

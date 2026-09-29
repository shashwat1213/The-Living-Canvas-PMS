import { useState } from 'react';

import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { approveContent, discardContent, regenerateContent, updateContent } from './api';
import { FORMAT_LABEL, STATUS_LABEL, STATUS_TONE, type MarketingContent } from './types';

/**
 * View / edit / act on one piece of content. Which actions show depends on
 * the piece's status and the caller's permissions (presentation only — the
 * API is the authority):
 *  - DRAFT/APPROVED: editable; DRAFT can be approved; both can be discarded.
 *  - FAILED/DRAFT/APPROVED/DISCARDED: can be regenerated (fresh from brief).
 *  - GENERATING: read-only, no actions (a job is in flight).
 */
export function ContentDialog({
  propertyId,
  content: initial,
  canManage,
  canApprove,
  onClose,
  onChanged,
}: {
  propertyId: string;
  content: MarketingContent;
  canManage: boolean;
  canApprove: boolean;
  onClose: () => void;
  onChanged: (content: MarketingContent) => void;
}) {
  const [content, setContent] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(content.title ?? '');
  const [body, setBody] = useState(content.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGenerating = content.status === 'GENERATING';
  const isEditable = content.status === 'DRAFT' || content.status === 'APPROVED';
  const canRegenerate = content.status !== 'GENERATING';

  async function run(action: () => Promise<{ content: MarketingContent }>) {
    setBusy(true);
    setError(null);
    try {
      const { content: updated } = await action();
      setContent(updated);
      setTitle(updated.title ?? '');
      setBody(updated.body ?? '');
      setEditing(false);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  const bodyChanged = body.trim() !== (content.body ?? '').trim();
  const titleChanged = title.trim() !== (content.title ?? '').trim();
  const canSave = editing && (bodyChanged || titleChanged) && body.trim().length > 0 && !busy;

  function saveEdit() {
    void run(() =>
      updateContent(propertyId, content.id, {
        title: titleChanged ? title.trim() || null : undefined,
        editedBody: bodyChanged ? body.trim() : undefined,
      }),
    );
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
        Close
      </button>
      {canManage && canRegenerate && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void run(() => regenerateContent(propertyId, content.id))}
          disabled={busy}
        >
          Regenerate
        </button>
      )}
      {canManage && content.status !== 'DISCARDED' && (
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void run(() => discardContent(propertyId, content.id))}
          disabled={busy}
        >
          Discard
        </button>
      )}
      {editing ? (
        <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={!canSave}>
          Save changes
        </button>
      ) : (
        <>
          {canManage && isEditable && (
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </button>
          )}
          {canApprove && content.status === 'DRAFT' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void run(() => approveContent(propertyId, content.id))}
              disabled={busy}
            >
              Approve
            </button>
          )}
        </>
      )}
    </>
  );

  return (
    <Modal
      title={content.title || FORMAT_LABEL[content.format]}
      description={`${FORMAT_LABEL[content.format]}${content.tone ? ` · ${content.tone}` : ''}`}
      onClose={onClose}
      size="wide"
      footer={footer}
    >
      <div className="marketing-detail">
        <div className="marketing-detail-head">
          <Badge tone={STATUS_TONE[content.status]}>{STATUS_LABEL[content.status]}</Badge>
          {content.isEdited && <span className="marketing-edited-tag">edited</span>}
          {content.provider && <span className="marketing-provider">via {content.provider}</span>}
        </div>

        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}

        <div className="marketing-brief">
          <h3>Brief</h3>
          <p>{content.brief}</p>
        </div>

        {isGenerating && (
          <p className="empty-state">Generating this piece… it will appear here once ready.</p>
        )}

        {content.status === 'FAILED' && (
          <p className="page-error" role="alert">
            Generation failed{content.lastError ? `: ${content.lastError}` : ''}. Try regenerating.
          </p>
        )}

        {!isGenerating && content.body !== null && !editing && (
          <div className="marketing-body">
            <h3>Content</h3>
            <pre className="marketing-body-text">{content.body}</pre>
          </div>
        )}

        {editing && (
          <div className="marketing-edit">
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </label>
            <label>
              Content
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
            </label>
          </div>
        )}

        {content.approvedBy && content.approvedAt && (
          <p className="marketing-approved-by">
            Approved by {content.approvedBy.firstName} {content.approvedBy.lastName} on{' '}
            {new Date(content.approvedAt).toLocaleString()}
          </p>
        )}
      </div>
    </Modal>
  );
}

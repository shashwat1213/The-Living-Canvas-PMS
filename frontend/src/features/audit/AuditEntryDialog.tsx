import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { changedFields, formatValue, humanizeField, summarize } from './summarize';
import { ACTION_LABEL, ENTITY_TYPE_LABEL, actorLabel, isDestructiveAction, type AuditEntry } from './types';

interface AuditEntryDialogProps {
  entry: AuditEntry;
  onClose: () => void;
  /** Filters the list to everything this actor did. */
  onFilterByActor: (actorUserId: string) => void;
  /** Filters the list to everything that happened to this record. */
  onFilterByEntity: (entityId: string) => void;
}

/**
 * The full record behind one row: who, when, what changed from what to
 * what. Read-only — there is no edit affordance anywhere, because an
 * audit entry that the people it records can amend is not evidence.
 */
export function AuditEntryDialog({ entry, onClose, onFilterByActor, onFilterByEntity }: AuditEntryDialogProps) {
  const fields = changedFields(entry);
  const entityLabel = ENTITY_TYPE_LABEL[entry.entityType as keyof typeof ENTITY_TYPE_LABEL] ?? entry.entityType;

  return (
    <Modal
      title={ACTION_LABEL[entry.action as keyof typeof ACTION_LABEL] ?? entry.action}
      description={summarize(entry)}
      size="wide"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="audit-detail">
        <dl className="audit-facts">
          <div>
            <dt>When</dt>
            <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Performed by</dt>
            <dd>
              {actorLabel(entry)}
              {entry.actorEmail && entry.actor && entry.actorEmail !== entry.actor.email && (
                // The captured email and the current one disagree, which
                // means the account changed hands or address since. Both
                // are shown rather than silently preferring one.
                <span className="audit-muted"> (recorded as {entry.actorEmail})</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Actor type</dt>
            <dd>{entry.actorType}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>
              {entityLabel} <code className="audit-id">{entry.entityId}</code>
            </dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd>
              <Badge tone={isDestructiveAction(entry.action) ? 'muted' : 'neutral'}>{entry.action}</Badge>
            </dd>
          </div>
        </dl>

        {fields.length > 0 && (
          <section className="audit-changes">
            <h3>What changed</h3>
            <table className="audit-change-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((change) => (
                  <tr key={change.field}>
                    <th scope="row">{humanizeField(change.field)}</th>
                    <td className="audit-from">{formatValue(change.from)}</td>
                    <td className="audit-to">{formatValue(change.to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="audit-changes">
          <h3>Recorded details</h3>
          {/* The raw entry, for anything the summary above doesn't cover —
              including actions added after this build shipped. */}
          <pre className="audit-raw">{JSON.stringify(entry.metadata ?? {}, null, 2)}</pre>
        </section>

        <div className="audit-detail-actions">
          {entry.actorUserId && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onFilterByActor(entry.actorUserId as string)}
            >
              Show everything by this person
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFilterByEntity(entry.entityId)}>
            Show this record&apos;s history
          </button>
        </div>
      </div>
    </Modal>
  );
}

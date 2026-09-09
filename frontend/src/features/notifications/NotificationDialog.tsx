import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE, type Notification } from './types';

/**
 * Read-only detail view of one notification: the full composed message and
 * its delivery state. There is no edit action — a notification is a record
 * of what the system sent, not an editable draft.
 */
export function NotificationDialog({
  notification,
  onClose,
}: {
  notification: Notification;
  onClose: () => void;
}) {
  const sent = notification.sentAt ? new Date(notification.sentAt).toLocaleString() : null;
  const created = new Date(notification.createdAt).toLocaleString();

  return (
    <Modal
      title={notification.subject || CHANNEL_LABEL[notification.channel]}
      description={`${CHANNEL_LABEL[notification.channel]} to ${notification.recipient}`}
      onClose={onClose}
      size="wide"
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="notif-detail">
        <div>
          <dt>Status</dt>
          <dd>
            <Badge tone={STATUS_TONE[notification.status]}>{STATUS_LABEL[notification.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{notification.type}</dd>
        </div>
        <div>
          <dt>Recipient</dt>
          <dd>{notification.recipient}</dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd>{created}</dd>
        </div>
        {sent && (
          <div>
            <dt>Sent</dt>
            <dd>{sent}</dd>
          </div>
        )}
        {notification.attempts > 0 && (
          <div>
            <dt>Attempts</dt>
            <dd>{notification.attempts}</dd>
          </div>
        )}
      </dl>

      {notification.lastError && (
        <p className="page-error" role="alert">
          {notification.lastError}
        </p>
      )}

      <div className="notif-body">
        <h3 className="notif-body-label">Message</h3>
        <pre className="notif-body-text">{notification.body}</pre>
      </div>
    </Modal>
  );
}

import type { ReactNode } from 'react';

import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  /** What will actually happen — state the consequence, not just "are you sure?". */
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive and is announced as such. */
  destructive?: boolean;
  busy?: boolean;
  /** Optional extra content in the dialog body — e.g. a reason input that
   * accompanies the confirmation. Most confirmations carry their whole
   * message in `message` and pass nothing here. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for a consequential action, replacing the native
 * `confirm()` used elsewhere in the app: that one can't be styled, can't
 * carry a description of the consequence, and blocks the main thread.
 * This one is a real focus-trapped dialog and can show a pending state
 * while the request is in flight.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      description={message}
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

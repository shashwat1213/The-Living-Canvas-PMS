import { useEffect, useId, useRef, type ReactNode } from 'react';

import './ui.css';

interface ModalProps {
  /** Rendered as the dialog's accessible name. */
  title: string;
  /** Optional supporting line under the title. */
  description?: string;
  onClose: () => void;
  /** Optional — a confirmation dialog carries its whole message in
   * `description`, so it has no body content of its own. */
  children?: ReactNode;
  /** Action buttons, rendered in the footer. */
  footer?: ReactNode;
  /** `wide` suits forms with side-by-side fields; `narrow` suits confirmations. */
  size?: 'narrow' | 'wide';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: labelled by its own title, closes on Escape and
 * on backdrop click, moves focus in on open, keeps Tab inside while open,
 * and restores focus to whatever opened it on close.
 *
 * Built here rather than pulled in as a dependency — this needs a focus
 * trap and an aria contract, not a design system, and the app has no
 * component library to be consistent with. It is deliberately generic:
 * nothing about staff, properties, or any other feature appears in it.
 */
export function Modal({ title, description, onClose, children, footer, size = 'narrow' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first control so keyboard and screen-reader users land
    // inside the dialog rather than behind it.
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialogRef.current)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) return;

      const firstEl = focusable[0] as HTMLElement;
      const lastEl = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;

      // Wrap at both ends so focus can never escape into the page behind.
      if (event.shiftKey && active === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="modal-description">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">
            &times;
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import './ui.css';

/**
 * A compact "More ▾" overflow menu for table rows. Keeps a row to one
 * primary action plus this menu instead of a wall of buttons — the pattern
 * Mews/Cloudbeds use for dense operational tables, and the only layout that
 * survives a phone screen.
 *
 * Accessible: button has aria-expanded/aria-controls, Escape and outside
 * click close it, and items are real links/buttons so keyboard and screen
 * readers work without extra roles.
 */
export function ActionMenu({ label = 'More', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="action-menu" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="action-menu-list" id={menuId} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

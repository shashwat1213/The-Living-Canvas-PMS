import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { BrandMark } from './AuthLayout';
import './public-pages.css';

export const CONTACT_EMAIL = 'shashwatpatni1234@gmail.com';

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        <span className="public-footer-brand">
          <BrandMark size={16} /> The Living Canvas
        </span>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
          <Link to="/login">Log in</Link>
          <a href="https://github.com/shashwat1213/The-Living-Canvas-PMS" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <small>© {new Date().getFullYear()} The Living Canvas. A portfolio project by Shashwat Patni.</small>
      </div>
    </footer>
  );
}

/** Simple top bar + readable content column for legal / static pages. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="public-page">
      <header className="public-topbar">
        <Link to="/" className="public-logo">
          <span className="public-logo-mark">
            <BrandMark size={18} />
          </span>
          The Living Canvas
        </Link>
        <Link to="/login" className="public-topbar-link">
          Log in
        </Link>
      </header>
      <main className="public-main">{children}</main>
      <PublicFooter />
    </div>
  );
}

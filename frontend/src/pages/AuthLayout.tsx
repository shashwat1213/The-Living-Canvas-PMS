import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import './auth-pages.css';

/**
 * The shared "front door" for every auth screen (log in, sign up, forgot /
 * reset password, verify email): a branded deep-green showcase panel on the
 * left and a focused form panel on the right. One layout keeps every entry
 * point visually identical — a Mews/Cloudbeds-class first impression.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <aside className="auth-hero" aria-hidden="true">
        <div className="auth-hero-glow" />
        <div className="auth-hero-grid" />
        <div className="auth-hero-top">
          <span className="auth-hero-mark">
            <BrandMark size={26} />
          </span>
          <span className="auth-hero-brand">The Living Canvas</span>
        </div>

        <div className="auth-hero-body">
          <span className="auth-hero-eyebrow">Hospitality platform</span>
          <h2 className="auth-hero-headline">
            Run every property
            <br />
            from one calm workspace.
          </h2>
          <p className="auth-hero-sub">
            Reservations, front desk, housekeeping, POS, revenue and AI marketing — the complete hospitality
            platform for modern hotels.
          </p>

          <ul className="auth-hero-features">
            <li>
              <span className="auth-hero-check" aria-hidden="true">✓</span>
              Live tape-chart calendar — drag to assign, move &amp; reschedule
            </li>
            <li>
              <span className="auth-hero-check" aria-hidden="true">✓</span>
              Folios, online payments &amp; PDF booking vouchers
            </li>
            <li>
              <span className="auth-hero-check" aria-hidden="true">✓</span>
              Board-grade revenue, occupancy, ADR &amp; RevPAR analytics
            </li>
          </ul>

          <div className="auth-hero-stats">
            <div className="auth-hero-stat">
              <span className="auth-hero-stat-num">19</span>
              <span className="auth-hero-stat-label">Connected modules</span>
            </div>
            <div className="auth-hero-stat">
              <span className="auth-hero-stat-num">Real-time</span>
              <span className="auth-hero-stat-label">Occupancy &amp; revenue</span>
            </div>
            <div className="auth-hero-stat">
              <span className="auth-hero-stat-num">Multi</span>
              <span className="auth-hero-stat-label">Property &amp; tenant</span>
            </div>
          </div>
        </div>

        <p className="auth-hero-foot">Trusted operations, from front desk to boardroom.</p>
      </aside>

      <div className="auth-panel">
        <div className="auth-panel-inner">
          <Link to="/" className="auth-brand auth-brand-mobile">
            <span className="auth-brand-mark">
              <BrandMark size={22} />
            </span>
            <span className="auth-brand-name">The Living Canvas</span>
          </Link>
          {children}
          <p className="auth-legal">
            <Link to="/privacy">Privacy</Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms">Terms</Link>
            <span aria-hidden="true">·</span>
            <Link to="/">Home</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportError } from '../lib/observability';

/**
 * Last line of defence: a render crash anywhere below shows a calm recovery
 * screen (and is reported to error tracking) instead of a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
    if (import.meta.env.DEV) console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-boot" role="alert">
        <span style={{ fontSize: '2.5rem' }} aria-hidden="true">
          🛠️
        </span>
        <h1 style={{ margin: 0 }}>Something went wrong</h1>
        <p className="app-boot-text" style={{ maxWidth: '44ch', textAlign: 'center' }}>
          The page hit an unexpected error. Our team has been notified. Reloading usually fixes it.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <a className="btn btn-ghost" href="/">
            Go home
          </a>
        </div>
      </div>
    );
  }
}

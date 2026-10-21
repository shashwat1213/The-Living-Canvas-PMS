import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './useAuth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="app-boot" role="status" aria-label="Loading">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <span className="app-boot-text">Loading your workspace…</span>
      </div>
    );
  }

  if (status === 'anonymous') {
    // Remember where they were headed so login can send them back there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';

import './index.css';
import './components/ui.css';
import { AppRouter } from './AppRouter.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initObservability } from './lib/observability.ts';

initObservability();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
    {/* Cookie-less page-view analytics; a no-op outside Vercel. */}
    <Analytics />
  </StrictMode>,
);

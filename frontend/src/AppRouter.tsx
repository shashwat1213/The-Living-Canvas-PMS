import { Navigate, Route, Routes } from 'react-router-dom';

import App from './App';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { PropertiesPage } from './pages/PropertiesPage';
import { RoomsPage } from './pages/RoomsPage';
import { SignupPage } from './pages/SignupPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="properties" replace />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/:propertyId/rooms" element={<RoomsPage />} />
      </Route>
    </Routes>
  );
}

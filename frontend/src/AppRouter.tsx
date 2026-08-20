import { Route, Routes } from 'react-router-dom';

import App from './App';
import { RequireAuth } from './auth/RequireAuth';
import { PropertiesPage } from './features/properties/PropertiesPage';
import { RoomsPage } from './features/rooms/RoomsPage';
import { StaffPage } from './features/staff/StaffPage';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
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
        <Route index element={<DashboardPage />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/:propertyId/rooms" element={<RoomsPage />} />
        <Route path="staff" element={<StaffPage />} />
      </Route>
    </Routes>
  );
}

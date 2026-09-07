import { Route, Routes } from 'react-router-dom';

import App from './App';
import { RequireAuth } from './auth/RequireAuth';
import { AuditPage } from './features/audit/AuditPage';
import { AvailabilityPage } from './features/availability/AvailabilityPage';
import { GuestsPage } from './features/guests/GuestsPage';
import { HousekeepingPage } from './features/housekeeping/HousekeepingPage';
import { MaintenancePage } from './features/maintenance/MaintenancePage';
import { PropertiesPage } from './features/properties/PropertiesPage';
import { RatePlansPage } from './features/rate-plans/RatePlansPage';
import { ReservationsPage } from './features/reservations/ReservationsPage';
import { RoomTypesPage } from './features/room-types/RoomTypesPage';
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
        <Route path="properties/:propertyId/reservations" element={<ReservationsPage />} />
        <Route path="properties/:propertyId/availability" element={<AvailabilityPage />} />
        <Route path="properties/:propertyId/housekeeping" element={<HousekeepingPage />} />
        <Route path="properties/:propertyId/maintenance" element={<MaintenancePage />} />
        <Route path="properties/:propertyId/room-types" element={<RoomTypesPage />} />
        <Route path="properties/:propertyId/room-types/:roomTypeId/rate-plans" element={<RatePlansPage />} />
        <Route path="guests" element={<GuestsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
    </Routes>
  );
}

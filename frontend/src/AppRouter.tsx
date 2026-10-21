import { Route, Routes } from 'react-router-dom';

import App from './App';
import { RequireAuth } from './auth/RequireAuth';
import { BookingPage } from './features/booking/BookingPage';
import { AuditPage } from './features/audit/AuditPage';
import { AvailabilityPage } from './features/availability/AvailabilityPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { GroupsPage } from './features/reservation-groups/GroupsPage';
import { PropertyDashboardPage } from './features/dashboard/PropertyDashboardPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { PosPage } from './features/pos/PosPage';
import { GuestsPage } from './features/guests/GuestsPage';
import { HousekeepingPage } from './features/housekeeping/HousekeepingPage';
import { MaintenancePage } from './features/maintenance/MaintenancePage';
import { MarketingPage } from './features/marketing/MarketingPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { PropertiesPage } from './features/properties/PropertiesPage';
import { RatePlansPage } from './features/rate-plans/RatePlansPage';
import { ReservationsPage } from './features/reservations/ReservationsPage';
import { RoomTypesPage } from './features/room-types/RoomTypesPage';
import { RoomsPage } from './features/rooms/RoomsPage';
import { StaffPage } from './features/staff/StaffPage';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/PasswordPages';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage, PrivacyPage, TermsPage } from './pages/StaticPages';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      {/* Public guest-facing booking site — no auth. */}
      <Route path="/book/:slug" element={<BookingPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="welcome" element={<OnboardingPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="properties" element={<PropertiesPage />} />
        <Route path="properties/:propertyId/rooms" element={<RoomsPage />} />
        <Route path="properties/:propertyId/reservations" element={<ReservationsPage />} />
        <Route path="properties/:propertyId/availability" element={<AvailabilityPage />} />
        <Route path="properties/:propertyId/calendar" element={<CalendarPage />} />
        <Route path="properties/:propertyId/blocks" element={<GroupsPage />} />
        <Route path="properties/:propertyId/dashboard" element={<PropertyDashboardPage />} />
        <Route path="properties/:propertyId/reports" element={<ReportsPage />} />
        <Route path="properties/:propertyId/pos" element={<PosPage />} />
        <Route path="properties/:propertyId/marketing" element={<MarketingPage />} />
        <Route path="properties/:propertyId/housekeeping" element={<HousekeepingPage />} />
        <Route path="properties/:propertyId/maintenance" element={<MaintenancePage />} />
        <Route path="properties/:propertyId/room-types" element={<RoomTypesPage />} />
        <Route path="properties/:propertyId/room-types/:roomTypeId/rate-plans" element={<RatePlansPage />} />
        <Route path="guests" element={<GuestsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

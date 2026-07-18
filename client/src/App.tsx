import { BrowserRouter, Navigate, Route, Routes, useLocation, type Location } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "./auth/AuthGate";
import { AuthPageGate } from "./auth/AuthPageGate";
import { AppShell } from "./layout/AppShell";
import { FirstBusinessRedirect } from "./pages/FirstBusinessRedirect";
import { CallsListPage } from "./pages/CallsListPage";
import { CallDetailPage } from "./pages/CallDetailPage";
import { LeadsListPage } from "./pages/LeadsListPage";
import { LeadDetailPage } from "./pages/LeadDetailPage";
import { MetricsPage } from "./pages/MetricsPage";
import { BusinessInfoSettingsPage } from "./pages/BusinessInfoSettingsPage";
import { VoiceSettingsPage } from "./pages/VoiceSettingsPage";
import { KnowledgeBasePage } from "./pages/KnowledgeBasePage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { SetupPage } from "./pages/auth/SetupPage";
import { MigratePage } from "./pages/auth/MigratePage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";

const queryClient = new QueryClient();

// A location pushed with { state: { backgroundLocation } } (see
// CallsTable.tsx's row click) — the standard react-router "modal route"
// pattern. The primary <Routes> below renders against the *background*
// location (so the calls list stays mounted underneath), while a second
// <Routes> matches the *real* current location and renders the call detail
// as an overlay on top of it. A direct navigation/refresh/bookmark to
// /calls/:conversationId carries no such state, so backgroundLocation is
// undefined and the primary <Routes> renders CallDetailPage as a normal
// full page instead — the modal is purely an enhancement for the
// navigate-from-the-list case, never the only way to reach a call.
function AuthenticatedRoutes() {
  const location = useLocation();
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;

  return (
    <AuthGate>
      <Routes location={backgroundLocation ?? location}>
        <Route path="/" element={<FirstBusinessRedirect />} />
        <Route path="/admin" element={<AppShell />}>
          <Route index element={<AdminSettingsPage />} />
        </Route>
        <Route path="/:businessId" element={<AppShell />}>
          <Route index element={<Navigate to="calls" replace />} />
          <Route path="calls" element={<CallsListPage />} />
          <Route path="calls/:conversationId" element={<CallDetailPage />} />
          <Route path="leads" element={<LeadsListPage />} />
          <Route path="leads/:leadId" element={<LeadDetailPage />} />
          <Route path="metrics" element={<MetricsPage />} />
          <Route path="settings/business-info" element={<BusinessInfoSettingsPage />} />
          <Route path="settings/voices" element={<VoiceSettingsPage />} />
          <Route path="settings/knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="admin" element={<AdminSettingsPage />} />
        </Route>
      </Routes>
      {backgroundLocation && (
        <Routes>
          <Route path="/:businessId/calls/:conversationId" element={<CallDetailPage />} />
          <Route path="/:businessId/leads/:leadId" element={<LeadDetailPage />} />
        </Routes>
      )}
    </AuthGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <Routes>
          {/* Siblings of the authenticated tree below, not children — these
              must never mount AuthGate (never call /api/session), since an
              unauthenticated visitor is exactly who's meant to reach them. */}
          <Route path="login" element={<AuthPageGate requiredState="ready"><LoginPage /></AuthPageGate>} />
          <Route path="setup" element={<AuthPageGate requiredState="fresh"><SetupPage /></AuthPageGate>} />
          <Route path="migrate" element={<AuthPageGate requiredState="needs_migration"><MigratePage /></AuthPageGate>} />
          <Route path="forgot-password" element={<AuthPageGate requiredState="ready"><ForgotPasswordPage /></AuthPageGate>} />
          <Route path="reset-password" element={<AuthPageGate requiredState="ready"><ResetPasswordPage /></AuthPageGate>} />
          <Route path="/*" element={<AuthenticatedRoutes />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

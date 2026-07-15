import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "./auth/AuthGate";
import { AuthPageGate } from "./auth/AuthPageGate";
import { AppShell } from "./layout/AppShell";
import { FirstBusinessRedirect } from "./pages/FirstBusinessRedirect";
import { CallsListPage } from "./pages/CallsListPage";
import { CallDetailPage } from "./pages/CallDetailPage";
import { MetricsPage } from "./pages/MetricsPage";
import { BusinessInfoSettingsPage } from "./pages/BusinessInfoSettingsPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { SetupPage } from "./pages/auth/SetupPage";
import { MigratePage } from "./pages/auth/MigratePage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";

const queryClient = new QueryClient();

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
          <Route
            path="/*"
            element={
              <AuthGate>
                <Routes>
                  <Route path="/" element={<FirstBusinessRedirect />} />
                  <Route path="/admin" element={<AppShell />}>
                    <Route index element={<AdminSettingsPage />} />
                  </Route>
                  <Route path="/:businessId" element={<AppShell />}>
                    <Route index element={<Navigate to="calls" replace />} />
                    <Route path="calls" element={<CallsListPage />} />
                    <Route path="calls/:conversationId" element={<CallDetailPage />} />
                    <Route path="metrics" element={<MetricsPage />} />
                    <Route path="settings/business-info" element={<BusinessInfoSettingsPage />} />
                    <Route path="admin" element={<AdminSettingsPage />} />
                  </Route>
                </Routes>
              </AuthGate>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

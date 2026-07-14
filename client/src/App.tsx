import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "./auth/AuthGate";
import { AppShell } from "./layout/AppShell";
import { FirstBusinessRedirect } from "./pages/FirstBusinessRedirect";
import { CallsListPage } from "./pages/CallsListPage";
import { CallDetailPage } from "./pages/CallDetailPage";
import { MetricsPage } from "./pages/MetricsPage";
import { BusinessInfoSettingsPage } from "./pages/BusinessInfoSettingsPage";
import { GeneralSettingsPage } from "./pages/GeneralSettingsPage";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <AuthGate>
          <Routes>
            <Route path="/" element={<FirstBusinessRedirect />} />
            <Route path="/:businessId" element={<AppShell />}>
              <Route index element={<Navigate to="calls" replace />} />
              <Route path="calls" element={<CallsListPage />} />
              <Route path="calls/:conversationId" element={<CallDetailPage />} />
              <Route path="metrics" element={<MetricsPage />} />
              <Route path="settings/business-info" element={<BusinessInfoSettingsPage />} />
              <Route path="settings/general" element={<GeneralSettingsPage />} />
            </Route>
          </Routes>
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

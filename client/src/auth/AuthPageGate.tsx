import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AuthState, AuthStateResponse } from "../api/types";

// Same query key/endpoint AuthEntryGate uses — React Query dedupes the
// fetch, so mounting both in the same tree (which never happens today, but
// could on a fast client-side nav) costs one request, not two.
function useAuthState() {
  return useQuery({
    queryKey: ["auth-state"],
    queryFn: () => api.get<AuthStateResponse>("/api/auth/state"),
  });
}

function pathForState(state: AuthState): string {
  if (state === "fresh") return "/setup";
  if (state === "needs_migration") return "/migrate";
  return "/login";
}

// Wraps each of the 5 pre-session pages. Mirrors two things the old
// server-rendered routes.ts did per-request: (1) redirectToAuthEntryPoint —
// if the deployment's actual state doesn't match what this specific page is
// for (e.g. someone hits /setup after an account already exists), redirect
// to whichever page *does* match; (2) the "already logged in" bounce —
// generalized here to all 5 pages, not just login, since there's no reason
// for an authenticated visitor to see any of these forms.
export function AuthPageGate({ requiredState, children }: { requiredState: AuthState; children: ReactNode }) {
  const { data, isLoading } = useAuthState();

  if (isLoading || !data) {
    return <div className="centered-spinner">Loading…</div>;
  }
  if (data.authenticated) {
    return <Navigate to="/" replace />;
  }
  if (data.state !== requiredState) {
    return <Navigate to={pathForState(data.state)} replace />;
  }
  return <>{children}</>;
}

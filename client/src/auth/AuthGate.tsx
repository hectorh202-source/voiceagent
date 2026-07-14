import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SessionUser } from "../api/types";

const AuthContext = createContext<SessionUser | null>(null);

export function useAuthedUser(): SessionUser {
  const user = useContext(AuthContext);
  if (!user) throw new Error("useAuthedUser called outside AuthGate");
  return user;
}

// Gates every route below it on a real session — api/client.ts's 401 handler
// already redirects to /settings/login on any failed request, so by the time
// this resolves successfully we know the user is authenticated.
export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<{ user: SessionUser }>("/api/session"),
  });

  if (isLoading || !data) {
    return <div className="centered-spinner">Loading…</div>;
  }

  return <AuthContext.Provider value={data.user}>{children}</AuthContext.Provider>;
}

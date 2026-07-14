import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import type { Business } from "../api/types";

// Bare /app lands here, then bounces to the first business's Calls page once
// the business list loads — avoids forcing the user to pick one every time.
export function FirstBusinessRedirect() {
  const { data, isLoading } = useQuery({
    queryKey: ["businesses"],
    queryFn: () => api.get<{ businesses: Business[] }>("/api/businesses"),
  });

  if (isLoading) return <div className="centered-spinner">Loading…</div>;
  if (!data || data.businesses.length === 0) {
    return <div className="centered-spinner">No businesses configured yet.</div>;
  }
  return <Navigate to={`/${data.businesses[0].id}/calls`} replace />;
}

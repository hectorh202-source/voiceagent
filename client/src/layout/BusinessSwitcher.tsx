import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { api } from "../api/client";
import type { Business } from "../api/types";

export function BusinessSwitcher() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data } = useQuery({
    queryKey: ["businesses"],
    queryFn: () => api.get<{ businesses: Business[] }>("/api/businesses"),
  });

  if (!data) return null;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newId = e.target.value;
    // On the business-agnostic global /admin page (no :businessId segment
    // at all), picking a business should load *that business's* admin
    // console, not bounce to its Calls page — the generic "swap the
    // businessId segment" logic below can't handle this case since there's
    // no businessId segment to swap in the first place.
    if (!businessId && location.pathname === "/admin") {
      navigate(`/${newId}/admin`);
      return;
    }
    // Swap the businessId segment while keeping the same page type (e.g.
    // /app/3/calls -> /app/5/calls, or /app/3/admin -> /app/5/admin) rather
    // than always bouncing to Calls.
    const rest = location.pathname.split("/").slice(2).join("/");
    navigate(`/${newId}/${rest}`);
  }

  return (
    <div className="business-switcher">
      <select value={businessId ?? ""} onChange={handleChange}>
        {!businessId && (
          <option value="" disabled>
            Select a business…
          </option>
        )}
        {data.businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}

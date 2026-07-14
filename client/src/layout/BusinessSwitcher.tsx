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
    // Swap the businessId segment while keeping the same page type (e.g.
    // /app/3/calls -> /app/5/calls) rather than always bouncing to Calls.
    // From the business-less /admin route this yields just "/<newId>/",
    // which the index-route redirect resolves to that business's Calls page.
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

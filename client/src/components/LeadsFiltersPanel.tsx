import type { LeadListFilters } from "../api/types";
import { DateRangePicker } from "./DateRangePicker";

const SOURCE_LABEL: Record<string, string> = {
  website_form: "Website form",
  website_chat: "Website chat",
  facebook_ads: "Facebook Ads",
  google_ads: "Google Ads",
};

export function LeadsFiltersPanel({
  filters,
  onChange,
}: {
  filters: LeadListFilters;
  onChange: (next: LeadListFilters) => void;
}) {
  return (
    <div className="filters-panel">
      <select
        value={filters.source ?? ""}
        onChange={(e) => onChange({ ...filters, source: (e.target.value || undefined) as never })}
      >
        <option value="">All sources</option>
        {Object.entries(SOURCE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        value={filters.status ?? ""}
        onChange={(e) => onChange({ ...filters, status: (e.target.value || undefined) as never })}
      >
        <option value="">All statuses</option>
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="qualified">Qualified</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
      <select
        value={filters.isRead === undefined ? "" : filters.isRead ? "1" : "0"}
        onChange={(e) => onChange({ ...filters, isRead: e.target.value === "" ? undefined : e.target.value === "1" })}
      >
        <option value="">Read + Unread</option>
        <option value="1">Read only</option>
        <option value="0">Unread only</option>
      </select>
      <DateRangePicker
        from={filters.from ?? ""}
        to={filters.to ?? ""}
        onChange={(from, to) => onChange({ ...filters, from: from || undefined, to: to || undefined })}
      />
    </div>
  );
}

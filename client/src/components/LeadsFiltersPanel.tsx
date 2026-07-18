import type { LeadListFilters } from "../api/types";
import { DateRangePicker } from "./DateRangePicker";
import { LEAD_SOURCE_OPTIONS, LEAD_STATUS_GROUPS } from "../lib/format";

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
        {LEAD_SOURCE_OPTIONS.map(({ value, label }) => (
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
        {LEAD_STATUS_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </optgroup>
        ))}
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

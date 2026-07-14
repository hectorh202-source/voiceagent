import type { CallListFilters } from "../api/types";
import { DateRangePicker } from "./DateRangePicker";

export function FiltersPanel({
  filters,
  onChange,
}: {
  filters: CallListFilters;
  onChange: (next: CallListFilters) => void;
}) {
  return (
    <div className="filters-panel">
      <label>
        <input
          type="checkbox"
          checked={filters.failedTransfer}
          onChange={(e) => onChange({ ...filters, failedTransfer: e.target.checked })}
        />{" "}
        Failed transfer
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.noBookingCreated}
          onChange={(e) => onChange({ ...filters, noBookingCreated: e.target.checked })}
        />{" "}
        No booking created
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.endedEarly}
          onChange={(e) => onChange({ ...filters, endedEarly: e.target.checked })}
        />{" "}
        Ended early
      </label>
      <select
        value={filters.status ?? ""}
        onChange={(e) => onChange({ ...filters, status: (e.target.value || undefined) as never })}
      >
        <option value="">All statuses</option>
        <option value="booked">Booked</option>
        <option value="not_booked">Not Booked</option>
        <option value="excused">Excused</option>
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

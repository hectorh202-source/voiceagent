import type { LeadStatus } from "../api/types";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

export function LeadsBulkActionBar({
  count,
  onMarkRead,
  onMarkUnread,
  onSetStatus,
  onClear,
}: {
  count: number;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSetStatus: (status: LeadStatus) => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="bulk-action-bar">
      <strong>{count} selected</strong>
      <button className="btn" onClick={onMarkRead}>
        Mark as read
      </button>
      <button className="btn" onClick={onMarkUnread}>
        Mark as unread
      </button>
      <select value="" onChange={(e) => e.target.value && onSetStatus(e.target.value as LeadStatus)}>
        <option value="">Set status…</option>
        {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <button className="link-btn" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}

import { Link } from "react-router-dom";
import type { CallListRow } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatDuration } from "../lib/format";

export function CallsTable({
  businessId,
  rows,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onToggleRead,
}: {
  businessId: string;
  rows: CallListRow[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleRead: (id: string, current: boolean) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.conversationId));

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>
            <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
          </th>
          <th>Status</th>
          <th>Date</th>
          <th>Duration</th>
          <th>Customer</th>
          <th>Call Handler</th>
          <th>Emergency</th>
          <th>Call Reason</th>
          <th>Job</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.conversationId}>
            <td>
              <input
                type="checkbox"
                checked={selected.has(row.conversationId)}
                onChange={() => onToggleSelect(row.conversationId)}
              />{" "}
              <button
                className="link-btn"
                title={row.isRead ? "Mark as unread" : "Mark as read"}
                onClick={() => onToggleRead(row.conversationId, row.isRead)}
              >
                {row.isRead ? "Read" : <strong>Unread</strong>}
              </button>
            </td>
            <td>
              <StatusBadge status={row.status} recoveryStatus={row.recoveryStatus} />
            </td>
            <td>
              <Link to={`/${businessId}/calls/${row.conversationId}`}>{formatDateTime(row.receivedAt)}</Link>
            </td>
            <td>{formatDuration(row.durationSecs)}</td>
            <td>
              {row.customerName ?? <span className="muted">Unknown</span>}
              {row.phone && (
                <>
                  <br />
                  <span className="muted">{row.phone}</span>
                </>
              )}
            </td>
            <td>{row.callHandler === "ai_human" ? "AI + Human" : "AI"}</td>
            <td>{row.isEmergency ? "⚠️" : "—"}</td>
            <td>{row.callReason ?? <span className="muted">—</span>}</td>
            <td>
              {row.jobId && (
                <span className="badge badge-neutral">Job #{row.jobId}</span>
              )}
              {!row.jobId && row.leadId && <span className="badge badge-neutral">Lead #{row.leadId}</span>}
              {!row.jobId && !row.leadId && <span className="muted">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useLocation, useNavigate } from "react-router-dom";
import type { CallListRow } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatDuration, formatPhoneNumber } from "../lib/format";

export function CallsTable({
  businessId,
  rows,
  selected,
  onToggleSelect,
  onToggleSelectAll,
}: {
  businessId: string;
  rows: CallListRow[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
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
          <tr
            key={row.conversationId}
            className="clickable-row"
            onClick={() =>
              navigate(`/${businessId}/calls/${row.conversationId}`, { state: { backgroundLocation: location } })
            }
          >
            <td onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.has(row.conversationId)}
                onChange={() => onToggleSelect(row.conversationId)}
              />{" "}
              {/* Read/unread is display-only here — the only way to change it
                  is the bulk action bar (select rows, then "Mark as
                  read"/"Mark as unread"), not a per-row click. */}
              {row.isRead ? "Read" : <strong>Unread</strong>}
            </td>
            <td>
              <StatusBadge status={row.status} recoveryStatus={row.recoveryStatus} />
            </td>
            <td>{formatDateTime(row.receivedAt)}</td>
            <td>{formatDuration(row.durationSecs)}</td>
            <td>
              {row.customerName ?? <span className="muted">Unknown</span>}
              {row.phone && (
                <>
                  <br />
                  <span className="muted">{formatPhoneNumber(row.phone)}</span>
                </>
              )}
            </td>
            <td>{row.callHandler === "ai_human" ? "AI + Human" : "AI"}</td>
            <td>{row.isEmergency ? "⚠️" : "—"}</td>
            <td>{row.callReason ?? <span className="muted">—</span>}</td>
            <td onClick={(e) => e.stopPropagation()}>
              {row.jobId && row.jobUrl && (
                <a className="badge badge-neutral" href={row.jobUrl} target="_blank" rel="noopener noreferrer">
                  Job #{row.jobId}
                </a>
              )}
              {!row.jobId && row.leadId && row.leadUrl && (
                <a className="badge badge-neutral" href={row.leadUrl} target="_blank" rel="noopener noreferrer">
                  Lead #{row.leadId}
                </a>
              )}
              {!row.jobId && !row.leadId && <span className="muted">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

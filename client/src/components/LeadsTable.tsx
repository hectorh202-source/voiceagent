import { useNavigate } from "react-router-dom";
import type { InboundLeadListRow, LeadSource, LeadStatus } from "../api/types";
import { formatDateTime, formatPhoneNumber } from "../lib/format";

const SOURCE_LABEL: Record<LeadSource, string> = {
  website_form: "Website form",
  website_chat: "Website chat",
  facebook_ads: "Facebook Ads",
  google_ads: "Google Ads",
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

const STATUS_CLASS: Record<LeadStatus, string> = {
  new: "badge-neutral",
  contacted: "badge-neutral",
  qualified: "badge-warning",
  won: "badge-success",
  lost: "badge-danger",
};

export function LeadsTable({
  businessId,
  rows,
  selected,
  onToggleSelect,
  onToggleSelectAll,
}: {
  businessId: string;
  rows: InboundLeadListRow[];
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
}) {
  const navigate = useNavigate();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>
            <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
          </th>
          <th>Status</th>
          <th>Date</th>
          <th>Source</th>
          <th>Name</th>
          <th>Phone</th>
          <th>Email</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className="clickable-row"
            onClick={() => navigate(`/${businessId}/leads/${row.id}`)}
          >
            <td onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => onToggleSelect(row.id)}
              />{" "}
              {row.isRead ? "Read" : <strong>Unread</strong>}
            </td>
            <td>
              <span className={`badge ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
            </td>
            <td>{formatDateTime(row.receivedAt)}</td>
            <td>{SOURCE_LABEL[row.source]}</td>
            <td>{row.name ?? <span className="muted">Unknown</span>}</td>
            <td>{row.phone ? formatPhoneNumber(row.phone) : <span className="muted">—</span>}</td>
            <td>{row.email ?? <span className="muted">—</span>}</td>
            <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.message ?? <span className="muted">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

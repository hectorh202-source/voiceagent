import type { CallStatus, RecoveryStatus } from "../api/types";

const STATUS_LABEL: Record<CallStatus, string> = {
  booked: "Booked",
  not_booked: "Not Booked",
  excused: "Excused",
};

const STATUS_CLASS: Record<CallStatus, string> = {
  booked: "badge-success",
  not_booked: "badge-danger",
  excused: "badge-neutral",
};

export function StatusBadge({ status, recoveryStatus }: { status: CallStatus; recoveryStatus: RecoveryStatus }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
      {recoveryStatus === "recovered" && <span className="badge badge-success">Recovered</span>}
      {recoveryStatus === "not_recovered" && <span className="badge badge-warning">Not Recovered</span>}
    </span>
  );
}

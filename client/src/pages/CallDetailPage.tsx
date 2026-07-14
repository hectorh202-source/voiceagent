import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CallDetail, CallStatus, RecoveryStatus } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";
import { formatDateTime, formatDuration } from "../lib/format";

export function CallDetailPage() {
  const { businessId, conversationId } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["call", businessId, conversationId],
    queryFn: () => api.get<CallDetail>(`/api/businesses/${businessId}/calls/${conversationId}`),
  });

  const patchMutation = useMutation({
    mutationFn: (body: { isRead?: boolean; recoveryStatus?: RecoveryStatus }) =>
      api.patch(`/api/businesses/${businessId}/calls`, { conversationIds: [conversationId], ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call", businessId, conversationId] });
      queryClient.invalidateQueries({ queryKey: ["calls", businessId] });
    },
  });

  if (isLoading) return <div>Loading…</div>;
  if (!data) return <div>Call not found.</div>;

  // Booking status isn't returned directly by this endpoint (only leadId/jobId
  // are) — a Job means booked, a Lead with no Job means not booked, neither
  // means excused, matching the same rule the calls list derives server-side.
  const status: CallStatus = data.jobId ? "booked" : data.leadId ? "not_booked" : "excused";

  return (
    <div>
      <Link to={`/${businessId}/calls`} className="link-btn">
        ← Back to Calls
      </Link>
      <h1>{data.customerName ?? "Unknown caller"}</h1>

      <div className="card">
        <div className="details-row">
          <span className="label">Status</span>
          <StatusBadge status={status} recoveryStatus={data.recoveryStatus} />
        </div>
        <div className="details-row">
          <span className="label">Time</span>
          <span>{formatDateTime(data.callTime)}</span>
        </div>
        <div className="details-row">
          <span className="label">Duration</span>
          <span>{formatDuration(data.durationSecs)}</span>
        </div>
        <div className="details-row">
          <span className="label">Phone</span>
          <span>{data.phone ?? "—"}</span>
        </div>
        <div className="details-row">
          <span className="label">Address</span>
          <span>{data.address ?? "—"}</span>
        </div>
        <div className="details-row">
          <span className="label">Emergency</span>
          <span>{data.isEmergency ? "Yes" : "No"}</span>
        </div>
        <div className="details-row">
          <span className="label">Call Reason</span>
          <span>{data.callReason ?? "—"}</span>
        </div>
        {data.leadUrl && (
          <div className="details-row">
            <span className="label">ST Lead</span>
            <a href={data.leadUrl} target="_blank" rel="noreferrer">
              View Lead in ServiceTitan
            </a>
          </div>
        )}
        {data.jobUrl && (
          <div className="details-row">
            <span className="label">ST Job</span>
            <a href={data.jobUrl} target="_blank" rel="noreferrer">
              View Job in ServiceTitan
            </a>
          </div>
        )}
        <div className="details-row">
          <span className="label">Transfer</span>
          <span>
            {!data.isTransferred
              ? "Not transferred"
              : data.transferFailed
                ? "Attempted — failed"
                : `Transferred to ${data.transferDestination ?? "unknown number"}`}
          </span>
        </div>
        <div className="details-row">
          <span className="label">Ended</span>
          <span>{data.terminationReason ?? "—"}</span>
        </div>
      </div>

      <div className="card">
        <button className="btn" onClick={() => patchMutation.mutate({ isRead: !data.isRead })}>
          {data.isRead ? "Mark as unread" : "Mark as read"}
        </button>{" "}
        <button className="btn" onClick={() => patchMutation.mutate({ recoveryStatus: "recovered" })}>
          Mark as recovered
        </button>{" "}
        <button className="btn" onClick={() => patchMutation.mutate({ recoveryStatus: "not_recovered" })}>
          Mark as not recovered
        </button>
      </div>

      {data.hasAudio && data.audioUrl && (
        <div className="card">
          <h2>Recording</h2>
          <audio controls src={data.audioUrl} style={{ width: "100%" }} />
        </div>
      )}

      {data.summary && (
        <div className="card">
          <h2>Summary</h2>
          <p>{data.summary}</p>
        </div>
      )}

      <div className="card">
        <h2>Transcript</h2>
        {data.transcript.length === 0 && <p className="muted">No transcript available.</p>}
        {data.transcript.map((turn, i) => (
          <div key={i} className={`transcript-turn ${turn.role === "user" ? "user" : "agent"}`}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{turn.timeLabel}</div>
            {turn.message}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CallDetail, CallStatus, RecoveryStatus } from "../api/types";
import { formatDateTime, formatDuration, formatPhoneNumber } from "../lib/format";
import {
  UserIcon,
  PhoneIcon,
  CalendarIcon,
  ClockIcon,
  MessageIcon,
  XCircleIcon,
  MapPinIcon,
  CopyIcon,
  ExternalLinkIcon,
  LinkIcon,
  CloseIcon,
  AlertIcon,
  ChevronDownIcon,
} from "../components/icons";

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
// Only used for the Bookability dropdown's "Default" option label, mirroring
// how the Auto (AI) value is grouped under "Bookable"/"Not Bookable" — the
// underlying value/badge everywhere else still just says "Excused".
const AUTO_STATUS_LABEL: Record<CallStatus, string> = {
  booked: "Bookable - Booked",
  not_booked: "Bookable - Not Booked",
  excused: "Not Bookable",
};

function useCopy(): [(text: string) => void, string | null] {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  }
  return [copy, copied];
}

export function CallDetailPage() {
  const { businessId, conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copy, copied] = useCopy();

  const { data, isLoading } = useQuery({
    queryKey: ["call", businessId, conversationId],
    queryFn: () => api.get<CallDetail>(`/api/businesses/${businessId}/calls/${conversationId}`),
  });

  const patchMutation = useMutation({
    mutationFn: (body: { isRead?: boolean; recoveryStatus?: RecoveryStatus; statusOverride?: CallStatus | null }) =>
      api.patch(`/api/businesses/${businessId}/calls`, { conversationIds: [conversationId], ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call", businessId, conversationId] });
      queryClient.invalidateQueries({ queryKey: ["calls", businessId] });
    },
  });

  if (isLoading) return <div className="centered-spinner">Loading…</div>;
  if (!data) return <div className="centered-spinner">Call not found.</div>;

  const publicCallUrl = `${window.location.origin}/b/${businessId}/calls/${conversationId}`;

  return (
    <div style={{ margin: "-24px" }}>
      <div className="call-detail-header">
        <div className="title">
          <PhoneIcon />
          Call Details
        </div>
        <button className="icon-btn" onClick={() => navigate(`/${businessId}/calls`)} title="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="call-detail-layout">
        <aside className="call-detail-sidebar">
          <div className="badge-row">
            <span className={`badge ${STATUS_CLASS[data.status]}`}>{STATUS_LABEL[data.status]}</span>
            <span className="badge badge-neutral">{data.isTransferred && !data.transferFailed ? "AI + Human" : "AI"}</span>
            <span className="badge badge-inbound">Inbound</span>
            {data.isEmergency && (
              <span className="badge badge-warning" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <AlertIcon width={12} height={12} /> Emergency
              </span>
            )}
          </div>

          <div className="info-section">
            <div className="info-section-title">Customer Information</div>
            <div className="info-row">
              <UserIcon />
              <div className="info-body">
                <div className="info-label">Name</div>
                <div className="info-value">{data.customerName ?? "Unknown"}</div>
              </div>
            </div>
            <div className="info-row">
              <PhoneIcon />
              <div className="info-body">
                <div className="info-label">Phone</div>
                <div className="info-value">
                  {data.phone ? formatPhoneNumber(data.phone) : "—"}
                  {data.phone && (
                    <button className="icon-btn" onClick={() => copy(data.phone!)} title="Copy phone number">
                      <CopyIcon width={13} height={13} />
                    </button>
                  )}
                  {copied === data.phone && <span className="muted" style={{ fontSize: 11 }}>Copied</span>}
                </div>
              </div>
            </div>
            {data.address && (
              <div className="info-row">
                <MapPinIcon />
                <div className="info-body">
                  <div className="info-label">Address</div>
                  <div className="info-value">{data.address}</div>
                </div>
              </div>
            )}
          </div>

          <div className="info-section">
            <div className="info-section-title">Call Information</div>
            <div className="info-row">
              <CalendarIcon />
              <div className="info-body">
                <div className="info-label">Call Time</div>
                <div className="info-value">{formatDateTime(data.callTime)}</div>
              </div>
            </div>
            <div className="info-row">
              <ClockIcon />
              <div className="info-body">
                <div className="info-label">Duration</div>
                <div className="info-value">{formatDuration(data.durationSecs)}</div>
              </div>
            </div>
            <div className="info-row">
              <MessageIcon />
              <div className="info-body">
                <div className="info-label">Reason</div>
                <div className="info-value">{data.callReason ?? "Not classified"}</div>
              </div>
            </div>
            <div className="info-row">
              <XCircleIcon />
              <div className="info-body">
                <div className="info-label">Ended</div>
                <div className="info-value">{data.terminationReason ?? "—"}</div>
              </div>
            </div>
            <div className="info-row">
              <PhoneIcon />
              <div className="info-body">
                <div className="info-label">Transfer</div>
                <div className="info-value">
                  {!data.isTransferred
                    ? "Not transferred"
                    : data.transferFailed
                      ? "Attempted — failed"
                      : `Transferred to ${data.transferDestination ? formatPhoneNumber(data.transferDestination) : "unknown number"}`}
                </div>
              </div>
            </div>
          </div>

          <div className="info-section">
            <div className="info-section-title">Bookability</div>
            <div className="select-display-wrap">
              <select
                className="select-display"
                value={data.statusOverride ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  patchMutation.mutate({ statusOverride: value === "" ? null : (value as CallStatus) });
                }}
              >
                <optgroup label="Default">
                  <option value="">{`Auto (AI) — ${AUTO_STATUS_LABEL[data.autoStatus]}`}</option>
                </optgroup>
                <optgroup label="Bookable">
                  <option value="booked">Booked</option>
                  <option value="not_booked">Not Booked</option>
                </optgroup>
                <optgroup label="Not Bookable">
                  <option value="excused">Not Bookable</option>
                </optgroup>
              </select>
              <ChevronDownIcon width={14} height={14} />
            </div>
          </div>

          <div className="info-section">
            <div className="info-section-title">Call Reason</div>
            <div className="select-display-wrap">
              <select className="select-display" value={data.callReason ?? ""} disabled>
                <option value={data.callReason ?? ""}>{data.callReason ?? "Not classified yet"}</option>
              </select>
              <ChevronDownIcon width={14} height={14} />
            </div>
          </div>

          <div className="info-section empty-state-section">
            <div className="info-section-title">Internal Notes</div>
            <div className="muted" style={{ fontSize: 13 }}>Not available yet.</div>
          </div>
          <div className="info-section empty-state-section">
            <div className="info-section-title">Tasks</div>
            <div className="muted" style={{ fontSize: 13 }}>Not available yet.</div>
          </div>
          <div className="info-section empty-state-section">
            <div className="info-section-title">Call History</div>
            <div className="muted" style={{ fontSize: 13 }}>Not available yet.</div>
          </div>
        </aside>

        <main className="call-detail-main">
          <div className="actions-row">
            <button className="btn" onClick={() => copy(publicCallUrl)}>
              <LinkIcon width={14} height={14} style={{ marginRight: 6 }} />
              {copied === publicCallUrl ? "Copied!" : "Copy Call Link"}
            </button>
            <a className="btn" href={publicCallUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              <ExternalLinkIcon width={14} height={14} style={{ marginRight: 6 }} />
              Open in New Tab
            </a>
            {data.leadUrl && (
              <a className="btn" href={data.leadUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                <ExternalLinkIcon width={14} height={14} style={{ marginRight: 6 }} />
                View Lead in ServiceTitan
              </a>
            )}
            {data.jobUrl && (
              <a className="btn" href={data.jobUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                <ExternalLinkIcon width={14} height={14} style={{ marginRight: 6 }} />
                View Job in ServiceTitan
              </a>
            )}
            <button className="btn" onClick={() => patchMutation.mutate({ isRead: !data.isRead })}>
              {data.isRead ? "Mark as unread" : "Mark as read"}
            </button>
            <button className="btn" onClick={() => patchMutation.mutate({ recoveryStatus: "recovered" })}>
              Mark as recovered
            </button>
            <button className="btn" onClick={() => patchMutation.mutate({ recoveryStatus: "not_recovered" })}>
              Mark as not recovered
            </button>
          </div>

          {data.summary && (
            <div className="card">
              <div className="card-header">
                <h2>Call Summary</h2>
                <button className="icon-btn" onClick={() => copy(data.summary!)} title="Copy summary">
                  <CopyIcon width={14} height={14} />
                  {copied === data.summary ? <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>Copied</span> : null}
                </button>
              </div>
              <p style={{ margin: 0 }}>{data.summary}</p>
            </div>
          )}

          {data.hasAudio && data.audioUrl && (
            <div className="card">
              <div className="card-header">
                <h2>Recording</h2>
              </div>
              <audio controls src={data.audioUrl} style={{ width: "100%" }} />
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h2>Transcript</h2>
            </div>
            {data.transcript.length === 0 && <p className="muted">No transcript available.</p>}
            {data.transcript.map((turn, i) => (
              <div key={i} className={`transcript-turn ${turn.role === "user" ? "user" : "agent"}`}>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{turn.timeLabel}</div>
                {turn.message}
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

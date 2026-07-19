import { useState, type ReactNode } from "react";
import { useParams, useNavigate, useLocation, type Location } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CallDetail, CallStatus, RecoveryStatus } from "../api/types";
import { formatDateTime, formatDuration, formatDurationClock, formatPhoneNumber } from "../lib/format";
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
  EditIcon,
  SaveIcon,
  TransferIcon,
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

// The Call Reason override dropdown's fixed groups — must stay in sync with
// src/api/schemas.ts's CALL_REASON_OVERRIDE_VALUES on the server, which
// validates a submitted override against this exact same list.
const CALL_REASON_GROUPS: { label: string; options: string[] }[] = [
  { label: "Booked", options: ["Booked - Repair", "Booked - Maintenance", "Booked - Sales/Estimate", "Booked - Service"] },
  {
    label: "Follow Up",
    options: [
      "Follow Up - Cancel",
      "Follow Up - Membership Cancel",
      "Follow Up - ETA",
      "Follow Up - Reschedule",
      "Follow Up - Other Update",
      "Follow Up - Complaint",
      "Follow Up - Compliment",
      "Follow Up - Invoice/Payment",
      "Follow Up - Confirming Time",
    ],
  },
  {
    label: "Excused",
    options: [
      "Excused - Test Call",
      "Excused - Outside of Area",
      "Excused - Outside of Services",
      "Excused - Telemarketing",
      "Excused - Spam",
      "Excused - Internal Call",
      "Excused - Employment",
      "Excused - Update Profile",
      "Excused - Other Questions",
      "Excused - No Reason",
      "Excused - Silent Call",
      "Excused - Not Homeowner",
      "Excused - Installation Call",
      "Excused - Live Agent Request",
      "Excused - Transfer to Specific Person",
      "Excused - Membership Inquiry",
      "Excused - Installation Pictures",
      "Excused - Returning Call",
    ],
  },
  {
    label: "Unbooked",
    options: [
      "Unbooked - Reject Agent",
      "Unbooked - Time Concern",
      "Unbooked - Price Concern",
      "Unbooked - Call Back Later",
      "Unbooked - Trip Charge",
      "Unbooked - Commercial",
      "Unbooked - Pending Coordination",
      "Unbooked - Callback (Previous Job)",
    ],
  },
  {
    label: "Outbound",
    options: [
      "Outbound - Voicemail",
      "Outbound - Not Interested",
      "Outbound - Not Available",
      "Outbound - Disconnected",
      "Outbound - Moved",
      "Outbound - Do Not Call",
    ],
  },
  // Matches the "Other" catch-all in the ElevenLabs enum (for a call that
  // doesn't fit any specific category) — without this, an AI-classified
  // "Other" call has no matching option here, so the dropdown falls back to
  // showing "Auto (AI) — Other" instead of a real selection.
  { label: "Other", options: ["Other"] },
];

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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [copy, copied] = useCopy();

  // Present only when reached via CallsTable.tsx's row click (see
  // App.tsx's AuthenticatedRoutes) — a direct navigation/refresh/bookmark
  // carries no such state, so this page renders as a normal full page in
  // that case instead of a modal, rather than requiring the modal as the
  // only way to reach a call.
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;
  const isModal = !!backgroundLocation;

  function closeModal() {
    navigate(-1);
  }

  function goToCall(nextConversationId: string) {
    navigate(`/${businessId}/calls/${nextConversationId}`, {
      replace: true,
      state: backgroundLocation ? { backgroundLocation } : undefined,
    });
  }

  const { data, isLoading } = useQuery({
    queryKey: ["call", businessId, conversationId],
    queryFn: () => api.get<CallDetail>(`/api/businesses/${businessId}/calls/${conversationId}`),
  });

  const patchMutation = useMutation({
    mutationFn: (body: {
      isRead?: boolean;
      recoveryStatus?: RecoveryStatus;
      statusOverride?: CallStatus | null;
      callReasonOverride?: string | null;
      internalNotes?: string | null;
    }) => api.patch(`/api/businesses/${businessId}/calls`, { conversationIds: [conversationId], ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call", businessId, conversationId] });
      queryClient.invalidateQueries({ queryKey: ["calls", businessId] });
      queryClient.invalidateQueries({ queryKey: ["unread-counts", businessId] });
    },
  });

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  // As a modal, this whole page renders inside a fixed-position overlay
  // (see App.tsx/CallsTable.tsx) instead of AppShell's padded .content
  // area, so it doesn't need the -24px trick a normal full-page route uses
  // to break out of that padding.
  function wrapIfModal(content: ReactNode) {
    if (!isModal) return content;
    return (
      <div className="modal-overlay" onClick={closeModal}>
        <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    );
  }

  if (isLoading) return wrapIfModal(<div className="centered-spinner">Loading…</div>);
  if (!data) return wrapIfModal(<div className="centered-spinner">Call not found.</div>);

  const publicCallUrl = `${window.location.origin}/b/${businessId}/calls/${conversationId}`;

  return wrapIfModal(
    <div className="call-detail-root" style={isModal ? undefined : { margin: "-24px" }}>
      <div className="call-detail-header">
        <div className="title">
          <PhoneIcon />
          Call Details
        </div>
        <button className="icon-btn" onClick={() => (isModal ? closeModal() : navigate(`/${businessId}/calls`))} title="Close">
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
              <select
                className="select-display"
                value={data.callReasonOverride ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  patchMutation.mutate({ callReasonOverride: value === "" ? null : value });
                }}
              >
                <optgroup label="Default">
                  <option value="">{`Auto (AI) — ${data.autoCallReason ?? "Not classified yet"}`}</option>
                </optgroup>
                {CALL_REASON_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDownIcon width={14} height={14} />
            </div>
          </div>

          <div className="info-section">
            <div className="info-section-header">
              <div className="info-section-title">Internal Notes</div>
              {!isEditingNotes && (
                <button
                  className="link-btn"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  onClick={() => {
                    setNotesDraft(data.internalNotes ?? "");
                    setIsEditingNotes(true);
                  }}
                >
                  <EditIcon width={13} height={13} />
                  {data.internalNotes ? "Edit" : "Add Note"}
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div>
                <textarea
                  className="notes-textarea"
                  placeholder="Add internal notes about this call…"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  autoFocus
                />
                <div className="notes-actions">
                  <button
                    className="link-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    onClick={() => setIsEditingNotes(false)}
                  >
                    <CloseIcon width={13} height={13} />
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    onClick={() => {
                      patchMutation.mutate({ internalNotes: notesDraft.trim() === "" ? null : notesDraft });
                      setIsEditingNotes(false);
                    }}
                  >
                    <SaveIcon width={13} height={13} />
                    Save
                  </button>
                </div>
              </div>
            ) : data.internalNotes ? (
              <div className="notes-display">{data.internalNotes}</div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>No notes added yet</div>
            )}
          </div>
          <div className="info-section empty-state-section">
            <div className="info-section-title">Tasks</div>
            <div className="muted" style={{ fontSize: 13 }}>Not available yet.</div>
          </div>
          <div className="info-section">
            <div className="info-section-title">Call History</div>
            {data.callHistory.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                No caller phone number is on file for this call, so no history could be found.
              </p>
            )}
            {data.callHistory.map((call) => (
              <div
                key={call.conversationId}
                className={`history-row ${call.conversationId === conversationId ? "current" : ""}`}
                onClick={() => {
                  if (call.conversationId !== conversationId) goToCall(call.conversationId);
                }}
              >
                <div className="history-row-top">
                  <strong>{call.customerName ?? "Unknown"}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(call.receivedAt)}</span>
                </div>
                <div className="history-row-meta">
                  <span className="history-row-detail">
                    <PhoneIcon width={13} height={13} />
                    {call.phone ? formatPhoneNumber(call.phone) : "—"}
                  </span>
                  <span className="history-row-detail">
                    <ClockIcon width={13} height={13} />
                    {formatDurationClock(call.durationSecs)}
                  </span>
                  <span className={`badge ${STATUS_CLASS[call.status]}`}>{STATUS_LABEL[call.status]}</span>
                  {call.isEmergency && (
                    <span className="badge badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <AlertIcon width={12} height={12} /> Emergency
                    </span>
                  )}
                  {call.isTransferred && (
                    <span className="badge badge-warning" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <TransferIcon width={12} height={12} /> Transferred
                    </span>
                  )}
                </div>
                {call.summary && <p className="history-row-summary">{call.summary}</p>}
              </div>
            ))}
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
                <h2>{data.hasHumanRecording ? "Recording — AI Portion" : "Recording"}</h2>
              </div>
              <audio controls src={data.audioUrl} style={{ width: "100%" }} />
            </div>
          )}

          {data.hasHumanRecording && data.humanRecordingUrl && (
            <div className="card">
              <div className="card-header">
                <h2>Recording — Human Portion</h2>
              </div>
              {/* One continuous Twilio Call recording spanning the whole
                  call, not a separately-cut file — seeking to the transfer's
                  timestamp on load is what makes this play back as "just the
                  human portion" (see dashboard/callDetails.ts's
                  humanRecordingOffsetSecs). */}
              <audio
                controls
                src={data.humanRecordingUrl}
                style={{ width: "100%" }}
                onLoadedMetadata={(e) => {
                  if (data.humanRecordingOffsetSecs) {
                    e.currentTarget.currentTime = data.humanRecordingOffsetSecs;
                  }
                }}
              />
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

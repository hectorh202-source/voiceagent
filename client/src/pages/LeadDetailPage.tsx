import { useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, type Location } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { InboundLeadDetail, LeadStatus } from "../api/types";
import { formatDateTime, formatPhoneNumber, getLeadSourceLabel } from "../lib/format";
import { UserIcon, PhoneIcon, MailIcon, MessageIcon, CalendarIcon, EditIcon, SaveIcon, CloseIcon } from "../components/icons";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

export function LeadDetailPage() {
  const { businessId, leadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Same modal-over-list pattern as CallDetailPage.tsx — present only when
  // reached via LeadsTable.tsx's row click (see App.tsx's
  // AuthenticatedRoutes). A direct navigation/refresh/bookmark carries no
  // such state, so this page renders as a normal full page in that case
  // instead of a modal.
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;
  const isModal = !!backgroundLocation;

  function closeModal() {
    navigate(-1);
  }

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

  const { data, isLoading } = useQuery({
    queryKey: ["lead", businessId, leadId],
    queryFn: () => api.get<InboundLeadDetail>(`/api/businesses/${businessId}/leads/${leadId}`),
  });

  const patchMutation = useMutation({
    mutationFn: (body: { status?: LeadStatus; internalNotes?: string | null; isRead?: boolean }) =>
      api.patch(`/api/businesses/${businessId}/leads`, { ids: [Number(leadId)], ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", businessId, leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads", businessId] });
    },
  });

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  if (isLoading) return wrapIfModal(<div className="centered-spinner">Loading…</div>);
  if (!data) return wrapIfModal(<div className="centered-spinner">Lead not found.</div>);

  return wrapIfModal(
    <div className="call-detail-root" style={isModal ? undefined : { margin: "-24px" }}>
      <div className="call-detail-header">
        <div className="title">
          <UserIcon />
          Lead Details
        </div>
        <button className="icon-btn" onClick={() => (isModal ? closeModal() : navigate(`/${businessId}/leads`))} title="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="card">
        <div className="info-section">
          <div className="info-section-title">Contact Information</div>
          <div className="info-row">
            <UserIcon />
            <div className="info-body">
              <div className="info-label">Name</div>
              <div className="info-value">{data.name ?? "Unknown"}</div>
            </div>
          </div>
          <div className="info-row">
            <PhoneIcon />
            <div className="info-body">
              <div className="info-label">Phone</div>
              <div className="info-value">{data.phone ? formatPhoneNumber(data.phone) : "—"}</div>
            </div>
          </div>
          <div className="info-row">
            <MailIcon />
            <div className="info-body">
              <div className="info-label">Email</div>
              <div className="info-value">{data.email ?? "—"}</div>
            </div>
          </div>
          <div className="info-row">
            <CalendarIcon />
            <div className="info-body">
              <div className="info-label">Received</div>
              <div className="info-value">
                {formatDateTime(data.receivedAt)} — {getLeadSourceLabel(data.source, data.sourceDetail)}
              </div>
            </div>
          </div>
        </div>

        {data.message && (
          <div className="info-section">
            <div className="info-section-title">Message</div>
            <div className="info-row">
              <MessageIcon />
              <div className="info-body">
                <div className="info-value">{data.message}</div>
              </div>
            </div>
          </div>
        )}

        <div className="info-section">
          <div className="info-section-title">Status</div>
          <div className="select-display-wrap">
            <select
              className="select-display"
              value={data.status}
              onChange={(e) => patchMutation.mutate({ status: e.target.value as LeadStatus })}
            >
              {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
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
                placeholder="Add internal notes about this lead…"
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

        <button className="btn" onClick={() => patchMutation.mutate({ isRead: !data.isRead })}>
          {data.isRead ? "Mark as unread" : "Mark as read"}
        </button>

        {/* Always shown, regardless of how well name/phone/email/message
            got matched — every client's form is labeled differently, so
            this is the one place staff can always see exactly what was
            actually submitted, not just what this app managed to parse. */}
        <div className="info-section" style={{ marginTop: 20 }}>
          <div className="info-section-title">Raw Submission Data</div>
          <div className="raw-dump">{data.rawDump || "(empty submission)"}</div>
        </div>
      </div>
    </div>
  );
}

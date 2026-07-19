import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { InboundLeadDetail, LeadStatus } from "../api/types";
import {
  formatDateTime,
  formatPhoneNumber,
  getLeadSourceLabel,
  getInitials,
  avatarColorFor,
  getLeadStatusLabel,
  getLeadStatusColors,
  LEAD_STATUS_GROUPS,
} from "../lib/format";
import {
  UserIcon,
  PhoneIcon,
  MailIcon,
  MessageIcon,
  CalendarIcon,
  EditIcon,
  SaveIcon,
  CloseIcon,
  ChevronDownIcon,
} from "../components/icons";

// Rendered inline inside LeadsPage.tsx's right-hand pane — always visible
// alongside the list, never a modal (see LeadsPage.tsx for the two-pane
// layout this lives in).
export function LeadDetailPage({ businessId, leadId }: { businessId: string; leadId: string }) {
  const queryClient = useQueryClient();

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
      queryClient.invalidateQueries({ queryKey: ["unread-counts", businessId] });
    },
  });

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");

  // Viewing a lead marks it read, same as opening an email — the unread dot
  // in LeadsPage.tsx's list otherwise never clears on its own, since nothing
  // else in this flow sets isRead except the explicit Mark as read/unread
  // button in the header.
  //
  // initializedLeadId tracks whether *this lead has been looked at yet*,
  // separately from whether it's currently read — not just "have we already
  // auto-marked it." Without that distinction, this bit: a lead that's
  // already read when opened never sets any guard, so clicking "Mark as
  // unread" flips isRead to false, the refetch delivers that new data, and
  // this effect (seeing an unread lead with no guard set) immediately
  // re-marks it read — the button visibly "flashes" back to read and needs
  // a second click, once the guard from the *first* click has finally been
  // recorded, to actually stick. Setting the guard unconditionally the
  // moment data for this leadId first arrives — before ever checking
  // isRead — means a manual toggle afterward is never second-guessed.
  const initializedLeadId = useRef<string | null>(null);
  useEffect(() => {
    if (data && initializedLeadId.current !== leadId) {
      initializedLeadId.current = leadId;
      if (!data.isRead) {
        patchMutation.mutate({ isRead: true });
      }
    }
  }, [data, leadId]);

  if (isLoading) return <div className="leads-empty-state">Loading…</div>;
  if (!data) return <div className="leads-empty-state">Lead not found.</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <div className="lead-avatar lead-avatar-lg" style={{ background: avatarColorFor(data.name) }}>
            {getInitials(data.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>{data.name ?? "Unknown Lead"}</h2>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {getLeadSourceLabel(data.source, data.sourceDetail)} · {formatDateTime(data.receivedAt)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button className="btn" onClick={() => patchMutation.mutate({ isRead: !data.isRead })}>
            {data.isRead ? "Mark as unread" : "Mark as read"}
          </button>
          <div className="status-select-wrap">
            <select
              className="status-select"
              value={data.status}
              onChange={(e) => patchMutation.mutate({ status: e.target.value as LeadStatus })}
              style={{ background: getLeadStatusColors(data.status).bg, color: getLeadStatusColors(data.status).fg }}
            >
              <option value="new">New</option>
              {LEAD_STATUS_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </optgroup>
              ))}
              {/* A lead still holding a retired status (contacted/qualified/
                  won/lost) from before this taxonomy replaced the original
                  5-value set — see schemas.ts's LEAD_STATUS_VALUES comment
                  on why old data is left as-is rather than migrated. Without
                  this, the select would silently fall back to its first
                  option ("New") since the real value isn't one of the
                  <option>s above, hiding the lead's true stored status. */}
              {data.status !== "new" && !LEAD_STATUS_GROUPS.some((group) => group.options.includes(data.status)) && (
                <option value={data.status}>{getLeadStatusLabel(data.status)}</option>
              )}
            </select>
            <ChevronDownIcon width={13} height={13} style={{ color: getLeadStatusColors(data.status).fg }} />
          </div>
        </div>
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

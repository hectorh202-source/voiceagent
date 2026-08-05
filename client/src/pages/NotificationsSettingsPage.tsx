import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { NotificationSettings } from "../api/types";

// Its own top-level nav link/page (see AppShell.tsx's "Settings" group) —
// used to live as a card at the bottom of Business Info, split out into its
// own section since it's a distinct enough concern to deserve its own URL.
// Reachable by any business user (see businessRouter.ts's GET/PUT
// /settings/notifications, not gated by requireApiPlatformAdmin), unlike
// General Settings/Admin Settings where the Teams webhook URL itself lives.
export function NotificationsSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notification-settings", businessId],
    queryFn: () => api.get<NotificationSettings>(`/api/businesses/${businessId}/settings/notifications`),
  });

  const [leadNotifyEnabled, setLeadNotifyEnabled] = useState(false);
  const [leadNotifyEmail, setLeadNotifyEmail] = useState("");
  const [leadNotifyCc, setLeadNotifyCc] = useState("");
  const [callNotifyEnabled, setCallNotifyEnabled] = useState(false);
  const [callNotifyEmail, setCallNotifyEmail] = useState("");
  const [callNotifyCc, setCallNotifyCc] = useState("");
  const [leadNotifyTeamsEnabled, setLeadNotifyTeamsEnabled] = useState(false);
  const [callNotifyTeamsEnabled, setCallNotifyTeamsEnabled] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setLeadNotifyEnabled(data.leadNotifyEnabled);
    setLeadNotifyEmail(data.leadNotifyEmail);
    setLeadNotifyCc(data.leadNotifyCc);
    setCallNotifyEnabled(data.callNotifyEnabled);
    setCallNotifyEmail(data.callNotifyEmail);
    setCallNotifyCc(data.callNotifyCc);
    setLeadNotifyTeamsEnabled(data.leadNotifyTeamsEnabled);
    setCallNotifyTeamsEnabled(data.callNotifyTeamsEnabled);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/notifications`, {
        leadNotifyEnabled,
        leadNotifyEmail,
        leadNotifyCc,
        callNotifyEnabled,
        callNotifyEmail,
        callNotifyCc,
        leadNotifyTeamsEnabled,
        callNotifyTeamsEnabled,
      }),
    onSuccess: () => {
      setSavedMessage("Notification settings saved.");
      queryClient.invalidateQueries({ queryKey: ["notification-settings", businessId] });
    },
  });

  if (isLoading) return <div>Loading…</div>;

  return (
    <div>
      <h1>Notifications</h1>
      <div className="card">
        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={leadNotifyEnabled}
              onChange={(e) => setLeadNotifyEnabled(e.target.checked)}
            />
            Email me new leads
          </label>
          <div className="form-hint">
            Fires for every new entry in this business's Leads inbox — website form, website chat, Facebook Ads,
            Google Ads Lead Form, Google LSA, and the AI phone agent's catch-all tool — the moment it's created,
            regardless of which of those produced it. Requires the platform's SMTP settings to be configured in the
            global Admin Settings.
          </div>
        </div>
        <div className="form-row">
          <label>Notification email</label>
          <input
            value={leadNotifyEmail}
            onChange={(e) => setLeadNotifyEmail(e.target.value)}
            placeholder="leads@yourbusiness.com, owner@yourbusiness.com"
          />
          <div className="form-hint">Primary recipients (the To line). Separate multiple addresses with commas.</div>
        </div>
        <div className="form-row">
          <label>CC (optional)</label>
          <input
            value={leadNotifyCc}
            onChange={(e) => setLeadNotifyCc(e.target.value)}
            placeholder="office@yourbusiness.com"
          />
          <div className="form-hint">Additional addresses copied on every alert. Separate multiple with commas.</div>
        </div>
        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={leadNotifyTeamsEnabled}
              onChange={(e) => setLeadNotifyTeamsEnabled(e.target.checked)}
            />
            Post new leads to Microsoft Teams
          </label>
          <div className="form-hint">
            Independent of "Email me new leads" above — turn on either, both, or neither. Requires an admin to
            configure a Teams webhook URL under Admin Settings first.
          </div>
        </div>
        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={callNotifyEnabled}
              onChange={(e) => setCallNotifyEnabled(e.target.checked)}
            />
            Email me completed calls
          </label>
          <div className="form-hint">
            Fires once for every AI phone agent call, right after it ends — separate from the Leads-inbox
            notification above, since a business might want one alert stream but not the other. Requires the
            platform's SMTP settings to be configured in the global Admin Settings.
          </div>
        </div>
        <div className="form-row">
          <label>Notification email</label>
          <input
            value={callNotifyEmail}
            onChange={(e) => setCallNotifyEmail(e.target.value)}
            placeholder="calls@yourbusiness.com, owner@yourbusiness.com"
          />
          <div className="form-hint">Primary recipients (the To line). Separate multiple addresses with commas.</div>
        </div>
        <div className="form-row">
          <label>CC (optional)</label>
          <input
            value={callNotifyCc}
            onChange={(e) => setCallNotifyCc(e.target.value)}
            placeholder="office@yourbusiness.com"
          />
          <div className="form-hint">Additional addresses copied on every alert. Separate multiple with commas.</div>
        </div>
        <div className="form-row">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={callNotifyTeamsEnabled}
              onChange={(e) => setCallNotifyTeamsEnabled(e.target.checked)}
            />
            Post completed calls to Microsoft Teams
          </label>
          <div className="form-hint">
            Independent of "Email me completed calls" above — turn on either, both, or neither. Requires an admin
            to configure a Teams webhook URL under Admin Settings first.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Save
        </button>
        {savedMessage && <span style={{ marginLeft: 8 }} className="muted">{savedMessage}</span>}
      </div>
    </div>
  );
}

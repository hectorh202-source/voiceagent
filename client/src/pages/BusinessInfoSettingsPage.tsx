import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BusinessInfoSettings, NotificationSettings, ServiceCategory } from "../api/types";

const CATEGORY_ROWS = 10;

function emptyCategories(): ServiceCategory[] {
  return Array.from({ length: CATEGORY_ROWS }, () => ({ name: "", businessUnitId: "", jobTypeId: "" }));
}

export function BusinessInfoSettingsPage() {
  const { businessId } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["business-info", businessId],
    queryFn: () => api.get<BusinessInfoSettings>(`/api/businesses/${businessId}/settings/business-info`),
  });

  const [name, setName] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [jobTypeId, setJobTypeId] = useState("");
  const [categories, setCategories] = useState<ServiceCategory[]>(emptyCategories());
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setBusinessUnitId(data.serviceTitanBusinessUnitId);
    setCampaignId(data.serviceTitanCampaignId);
    setJobTypeId(data.serviceTitanJobTypeId);
    const rows = emptyCategories();
    data.serviceCategories.forEach((c, i) => {
      if (i < CATEGORY_ROWS) rows[i] = c;
    });
    setCategories(rows);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/business-info`, {
        name,
        serviceTitanBusinessUnitId: businessUnitId,
        serviceTitanCampaignId: campaignId,
        serviceTitanJobTypeId: jobTypeId,
        serviceCategories: categories.filter((c) => c.name.trim()),
      }),
    onSuccess: () => {
      setSavedMessage("Settings saved.");
      queryClient.invalidateQueries({ queryKey: ["business-info", businessId] });
    },
  });

  function updateCategory(index: number, field: keyof ServiceCategory, value: string) {
    setCategories((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  // Own query/state/save button, independent of the business-info card
  // above — reachable by any business user (see businessRouter.ts's GET/PUT
  // /settings/notifications, not platform-admin-gated, unlike the rest of
  // General Settings where these lived before). A separate mutation rather
  // than folding into saveMutation above so saving one doesn't require
  // touching the other.
  const { data: notifyData } = useQuery({
    queryKey: ["notification-settings", businessId],
    queryFn: () => api.get<NotificationSettings>(`/api/businesses/${businessId}/settings/notifications`),
  });

  const [leadNotifyEnabled, setLeadNotifyEnabled] = useState(false);
  const [leadNotifyEmail, setLeadNotifyEmail] = useState("");
  const [leadNotifyCc, setLeadNotifyCc] = useState("");
  const [callNotifyEnabled, setCallNotifyEnabled] = useState(false);
  const [callNotifyEmail, setCallNotifyEmail] = useState("");
  const [callNotifyCc, setCallNotifyCc] = useState("");
  const [notifySavedMessage, setNotifySavedMessage] = useState("");

  useEffect(() => {
    if (!notifyData) return;
    setLeadNotifyEnabled(notifyData.leadNotifyEnabled);
    setLeadNotifyEmail(notifyData.leadNotifyEmail);
    setLeadNotifyCc(notifyData.leadNotifyCc);
    setCallNotifyEnabled(notifyData.callNotifyEnabled);
    setCallNotifyEmail(notifyData.callNotifyEmail);
    setCallNotifyCc(notifyData.callNotifyCc);
  }, [notifyData]);

  const saveNotificationsMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/notifications`, {
        leadNotifyEnabled,
        leadNotifyEmail,
        leadNotifyCc,
        callNotifyEnabled,
        callNotifyEmail,
        callNotifyCc,
      }),
    onSuccess: () => {
      setNotifySavedMessage("Notification settings saved.");
      queryClient.invalidateQueries({ queryKey: ["notification-settings", businessId] });
    },
  });

  if (isLoading) return <div>Loading…</div>;

  return (
    <div>
      <h1>Business Info</h1>
      <div className="card">
        <div className="form-row">
          <label>Business name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Default business unit ID</label>
          <input value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)} />
          <div className="form-hint">Used if no service category matches.</div>
        </div>
        <div className="form-row">
          <label>Default campaign ID</label>
          <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Default job type ID</label>
          <input value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)} />
          <div className="form-hint">Used if no service category matches.</div>
        </div>
      </div>

      <div className="card">
        <h2>Service categories (optional)</h2>
        <p className="form-hint">Classify calls into a business unit/job type by name (e.g. "Plumbing", "HVAC").</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Business Unit ID</th>
                <th>Job Type ID</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={i}>
                  <td>
                    <input value={c.name} onChange={(e) => updateCategory(i, "name", e.target.value)} />
                  </td>
                  <td>
                    <input value={c.businessUnitId} onChange={(e) => updateCategory(i, "businessUnitId", e.target.value)} />
                  </td>
                  <td>
                    <input value={c.jobTypeId} onChange={(e) => updateCategory(i, "jobTypeId", e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Save
      </button>
      {savedMessage && <span style={{ marginLeft: 8 }} className="muted">{savedMessage}</span>}

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Notifications</h2>
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
        <button
          className="btn btn-primary"
          onClick={() => saveNotificationsMutation.mutate()}
          disabled={saveNotificationsMutation.isPending}
        >
          Save
        </button>
        {notifySavedMessage && <span style={{ marginLeft: 8 }} className="muted">{notifySavedMessage}</span>}
      </div>
    </div>
  );
}

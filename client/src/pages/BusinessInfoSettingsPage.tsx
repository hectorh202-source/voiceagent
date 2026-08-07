import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BusinessInfoSettings } from "../api/types";

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
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setBusinessUnitId(data.serviceTitanBusinessUnitId);
    setCampaignId(data.serviceTitanCampaignId);
    setJobTypeId(data.serviceTitanJobTypeId);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/api/businesses/${businessId}/settings/business-info`, {
        name,
        serviceTitanBusinessUnitId: businessUnitId,
        serviceTitanCampaignId: campaignId,
        serviceTitanJobTypeId: jobTypeId,
      }),
    onSuccess: () => {
      setSavedMessage("Settings saved.");
      queryClient.invalidateQueries({ queryKey: ["business-info", businessId] });
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
          <label>Default business unit ID (fallback)</label>
          <input value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)} />
          <div className="form-hint">
            Used only when the AI agent's captured service type doesn't match any of this business's real
            ServiceTitan job types by name — that live lookup is checked first on every call, so this fallback
            never needs updating just because ServiceTitan-side job types changed.
          </div>
        </div>
        <div className="form-row">
          <label>Default campaign ID</label>
          <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
          <div className="form-hint">Required by ServiceTitan on every lead — there's no way to infer which campaign to attribute a call to, so this always applies.</div>
        </div>
        <div className="form-row">
          <label>Default job type ID (fallback)</label>
          <input value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)} />
          <div className="form-hint">Same fallback reasoning as the business unit ID above.</div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Save
      </button>
      {savedMessage && <span style={{ marginLeft: 8 }} className="muted">{savedMessage}</span>}
    </div>
  );
}
